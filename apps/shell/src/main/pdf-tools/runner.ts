import { Worker } from 'node:worker_threads'
import type {
  FileInfo,
  ToolProgress,
  ToolRequest,
  ToolResult,
  ToolResultItem,
} from '../../shared/pdf-tools-api'
import { REPORTED, RUNNING, WRITING, cancelSlot, newControl } from './control'
import type { WorkerInit, WorkerMessage, WorkerRequest } from './worker'

/** Idle time before the worker (and its wasm heap) is released. */
const IDLE_MS = 30_000

/** How long a canceled run gets to stop at a file or page boundary before its thread is stopped. */
const CANCEL_GRACE_MS = 1000

/** Omit that keeps a union a union */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

type Pending = {
  req: WorkerRequest
  /** null when the worker died before answering */
  resolve: (msg: WorkerMessage | null) => void
  onProgress?: (progress: ToolProgress) => void
  /** run: the inputs finished so far, for a run whose thread is stopped */
  items: ToolResultItem[]
}

/**
 * One worker thread, started on first use and stopped when idle. Requests run
 * one at a time in the worker (MuPDF is single-threaded); a crash fails the
 * requests in flight and the next request starts a fresh worker.
 */
export class PdfToolsRunner {
  private worker: Worker | null = null
  /** shared with the current worker (control.ts) */
  private control: Int32Array<SharedArrayBuffer> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private idleTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly workerPath: string,
    private readonly init: () => Omit<WorkerInit, 'control'>,
  ) {}

  /** Aborting `signal` cancels the run: it resolves with what was done and `canceled: true`. */
  run(
    request: ToolRequest,
    onProgress?: (progress: ToolProgress) => void,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    if (signal?.aborted) return Promise.resolve({ ok: true, items: [], canceled: true })
    const { id, reply } = this.send({ type: 'run', request }, onProgress)
    const abort = () => this.cancel(id)
    signal?.addEventListener('abort', abort, { once: true })
    return reply.then((msg) => {
      signal?.removeEventListener('abort', abort)
      return msg?.type === 'run' ? msg.result : crashed<ToolResult>()
    })
  }

  info(path: string, password?: string): Promise<FileInfo> {
    return this.send({ type: 'info', path, ...(password ? { password } : {}) }).reply.then((msg) =>
      msg?.type === 'info' ? msg.info : crashed<FileInfo>(),
    )
  }

  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const w = this.worker
    this.worker = null
    this.control = null
    void w?.terminate()
  }

  private send(
    req: WithoutId<WorkerRequest>,
    onProgress?: (progress: ToolProgress) => void,
  ): { id: number; reply: Promise<WorkerMessage | null> } {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const id = this.nextId++
    const worker = this.ensureWorker()
    const full = { ...req, id } as WorkerRequest
    const reply = new Promise<WorkerMessage | null>((resolve) => {
      this.pending.set(id, { req: full, resolve, onProgress, items: [] })
      worker.postMessage(full)
    })
    return { id, reply }
  }

  private cancel(id: number): void {
    const p = this.pending.get(id)
    const ctl = this.control
    if (!p || !ctl) return
    Atomics.store(ctl, cancelSlot(id), id)
    // the worker takes requests in id order
    const running = Atomics.load(ctl, RUNNING)
    if (running < id) {
      // still queued: answer now; the worker passes over it when it gets there
      this.settle(id, canceledReply(id, []))
    } else if (running === id) {
      // it stops by itself at the next file or page; one long step (a big
      // compress, a page render) is cut short by stopping the thread
      setTimeout(() => this.forceStop(id), CANCEL_GRACE_MS).unref?.()
    }
    // else it has already finished and its answer is on the way
  }

  private forceStop(id: number): void {
    const p = this.pending.get(id)
    const w = this.worker
    const ctl = this.control
    if (!p || !w || !ctl) return
    // never cut a file in half, nor lose one: wait out a write, and the
    // reports of written files that are still on their way
    if (Atomics.load(ctl, WRITING) === 1 || Atomics.load(ctl, REPORTED) > p.items.length) {
      setTimeout(() => this.forceStop(id), 50).unref?.()
      return
    }
    this.pending.delete(id)
    const queued = [...this.pending.values()]
    this.pending.clear()
    this.worker = null
    this.control = null
    void w.terminate()
    p.resolve(canceledReply(id, p.items))
    // what waited behind it starts over on a fresh thread
    if (queued.length === 0) return
    const fresh = this.ensureWorker()
    for (const q of queued) {
      this.pending.set(q.req.id, q)
      fresh.postMessage(q.req)
    }
  }

  private settle(id: number, msg: WorkerMessage): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    p.resolve(msg)
    if (this.pending.size === 0) this.scheduleIdleStop()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const control = newControl()
    const w = new Worker(this.workerPath, {
      workerData: { ...this.init(), control: control.buffer } satisfies WorkerInit,
    })
    w.on('message', (msg: WorkerMessage) => {
      // a stopped thread can still post while it winds down
      if (this.worker !== w) return
      const p = this.pending.get(msg.id)
      if (!p) return
      if (msg.type === 'progress') p.onProgress?.(msg.progress)
      else if (msg.type === 'item') p.items.push(msg.item)
      else this.settle(msg.id, msg)
    })
    const drop = (err?: unknown) => {
      if (this.worker !== w) return
      this.worker = null
      this.control = null
      if (err) console.error('pdf tools worker failed', err)
      for (const p of this.pending.values()) p.resolve(null)
      this.pending.clear()
    }
    w.on('error', drop)
    w.on('exit', () => drop())
    this.worker = w
    this.control = control
    return w
  }

  private scheduleIdleStop() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.pending.size === 0) this.stop()
    }, IDLE_MS)
    this.idleTimer.unref?.()
  }
}

function canceledReply(id: number, items: ToolResultItem[]): WorkerMessage {
  return { id, type: 'run', result: { ok: true, items, canceled: true } }
}

/** What a request resolves to when the worker died under it (out of memory, wasm abort). */
function crashed<T extends ToolResult | FileInfo>(): T {
  return {
    ok: false,
    error: {
      code: 'failed',
      message: 'the PDF engine stopped unexpectedly; the file may be too large for this computer',
    },
  } as T
}
