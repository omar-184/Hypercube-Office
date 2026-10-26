import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { ToolRequest } from '../src/shared/pdf-tools-api'
import { CANCEL_SLOTS, REPORTED, RUNNING, WRITING } from '../src/main/pdf-tools/control'
import { PdfToolsRunner } from '../src/main/pdf-tools/runner'

/**
 * Stands in for worker.ts: the same protocol and control slots, without
 * MuPDF. Each input is `ms` of synchronous work, like a MuPDF call that cannot
 * read messages until it returns, then a write of `writeMs` through a .part name.
 */
const FAKE_WORKER = `
import { renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
const ctl = new Int32Array(workerData.control)
const busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} }
parentPort.on('message', (req) => {
  const post = (msg) => parentPort.postMessage(msg)
  if (req.type === 'info') return post({ id: req.id, type: 'info', info: { ok: true, kind: 'image', size: 1 } })
  const { id } = req
  const canceled = () => Atomics.load(ctl, id % ${CANCEL_SLOTS}) === id
  Atomics.store(ctl, ${REPORTED}, 0)
  Atomics.store(ctl, ${RUNNING}, id)
  const { files, options: o, outputDir } = req.request
  const items = []
  const stopped = () => post({ id, type: 'run', result: { ok: true, items, canceled: true } })
  for (const [i, f] of files.entries()) {
    if (canceled()) return stopped()
    busy(o.ms)
    Atomics.store(ctl, ${WRITING}, 1)
    if (canceled()) {
      Atomics.store(ctl, ${WRITING}, 0)
      return stopped()
    }
    const out = join(outputDir, basename(f.path) + '.out')
    writeFileSync(out + '.part', 'x')
    busy(o.writeMs ?? 0)
    renameSync(out + '.part', out)
    const item = { source: f.path, outputs: [{ path: out, size: 1 }] }
    items.push(item)
    post({ id, type: 'item', item })
    Atomics.add(ctl, ${REPORTED}, 1)
    Atomics.store(ctl, ${WRITING}, 0)
    post({ id, type: 'progress', progress: { done: i + 1, total: files.length } })
  }
  post({ id, type: 'run', result: { ok: true, items } })
})
`

let workerDir: string
let out: string
let runner: PdfToolsRunner

beforeAll(() => {
  workerDir = mkdtempSync(join(tmpdir(), 'pdf-tools-runner-'))
  writeFileSync(join(workerDir, 'worker.mjs'), FAKE_WORKER)
})
afterAll(() => rmSync(workerDir, { recursive: true, force: true }))

function newRunner() {
  out = mkdtempSync(join(tmpdir(), 'pdf-tools-runner-out-'))
  runner = new PdfToolsRunner(join(workerDir, 'worker.mjs'), () => ({
    mupdfPath: '',
    ocrHelperPath: null,
  }))
}
afterEach(() => {
  runner.stop()
  rmSync(out, { recursive: true, force: true })
})

/** `n` inputs of `ms` work each, written to the test's output folder */
function request(n: number, ms: number, writeMs = 0): ToolRequest {
  return {
    tool: 'flatten',
    files: Array.from({ length: n }, (_, i) => ({ path: `in-${i}.pdf` })),
    options: { ms, writeMs } as never,
    outputDir: out,
  }
}

const outputs = () => readdirSync(out).sort()

describe('PDF tools runner', () => {
  it('stops at the next input when canceled and reports the ones done', async () => {
    newRunner()
    const abort = new AbortController()
    const started = Date.now()
    const res = await runner.run(
      request(6, 150),
      (p) => p.done === 2 && abort.abort(),
      abort.signal,
    )
    expect(res).toMatchObject({ ok: true, canceled: true })
    expect(res.ok && res.items.map((i) => i.source)).toEqual(['in-0.pdf', 'in-1.pdf'])
    expect(outputs()).toEqual(['in-0.pdf.out', 'in-1.pdf.out'])
    // it stopped by itself, well before its thread would have been stopped
    expect(Date.now() - started).toBeLessThan(900)
  })

  it('cuts one long step short, and the next request gets a fresh thread', async () => {
    newRunner()
    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 100)
    const res = await runner.run(request(1, 30_000), undefined, abort.signal)
    expect(res).toEqual({ ok: true, items: [], canceled: true })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(outputs()).toEqual([])
    expect(await runner.run(request(1, 0))).toMatchObject({ ok: true, items: [{}] })
  })

  it('lets a write finish and reports it before stopping the thread', async () => {
    newRunner()
    const abort = new AbortController()
    // the cancel lands early in a 1.6 s write, which outlasts the grace period
    setTimeout(() => abort.abort(), 300)
    const res = await runner.run(request(2, 0, 1600), undefined, abort.signal)
    expect(res).toMatchObject({ ok: true, canceled: true })
    expect(res.ok && res.items.map((i) => i.source)).toEqual(['in-0.pdf'])
    expect(outputs()).toEqual(['in-0.pdf.out'])
    expect(existsSync(join(out, 'in-0.pdf.out.part'))).toBe(false)
  }, 10_000)

  it('answers a canceled request that is still queued at once and keeps the rest', async () => {
    newRunner()
    const first = runner.run(request(1, 600))
    const abort = new AbortController()
    const second = runner.run(request(1, 0), undefined, abort.signal)
    const info = runner.info('x.png')
    abort.abort()
    expect(await second).toEqual({ ok: true, items: [], canceled: true })
    expect(await first).toMatchObject({ ok: true, items: [{ source: 'in-0.pdf' }] })
    expect(await info).toMatchObject({ ok: true })
  })

  it('restarts the requests queued behind a run whose thread it stopped', async () => {
    newRunner()
    const abort = new AbortController()
    const long = runner.run(request(1, 30_000), undefined, abort.signal)
    const queued = runner.info('y.png')
    setTimeout(() => abort.abort(), 100)
    expect(await long).toMatchObject({ ok: true, canceled: true })
    expect(await queued).toMatchObject({ ok: true, kind: 'image' })
  })
})
