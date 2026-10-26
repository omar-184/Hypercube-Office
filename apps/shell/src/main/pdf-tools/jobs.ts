/**
 * Runs one PDF tool request against files on disk: read inputs, call the
 * engine, write outputs without overwriting anything. Lives in the worker
 * thread; kept free of Electron so tests drive it directly.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import {
  ALL_PERMISSIONS,
  COMPRESS_PRESETS,
  type Mupdf,
  PageRangeError,
  PdfToolError,
  type ToolInput,
  type ToolOutput,
  addPageNumbers,
  addWatermark,
  compressPdf,
  deletePages,
  extractImages,
  extractPages,
  flattenPdf,
  imagesToPdf,
  mergePdfs,
  type OcrRecognizer,
  ocrPdf,
  pdfInfo,
  pdfToImages,
  protectPdf,
  readMetadata,
  reorderPages,
  repairPdf,
  rotatePages,
  splitPdf,
  stem,
  unlockPdf,
  writeMetadata,
} from '@genoffice/pdf-tools'
import {
  COMBINING_TOOLS,
  type FileInfo,
  IMAGE_EXTENSIONS,
  type ToolError,
  type ToolFile,
  type ToolOutputFile,
  type ToolProgress,
  type ToolRequest,
  type ToolResult,
  type ToolResultItem,
} from '../../shared/pdf-tools-api'

/** Inputs larger than this would not fit the wasm heap next to their output on a 4 GB machine. */
export const MAX_INPUT_BYTES = 1024 * 1024 * 1024

function toToolError(err: unknown, file?: string): ToolError {
  if (err instanceof PdfToolError) {
    return { code: err.code, message: err.message, file: err.file ?? file }
  }
  if (err instanceof PageRangeError) return { code: 'bad-pages', message: err.message, file }
  const e = err as NodeJS.ErrnoException
  if (e && typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code)) {
    return { code: 'io', message: e.message, file }
  }
  return { code: 'failed', message: e?.message ?? String(err), file }
}

function readInput(file: ToolFile): ToolInput {
  const size = statSync(file.path).size
  if (size > MAX_INPUT_BYTES) {
    throw new PdfToolError('unsupported', `${basename(file.path)} is larger than 1 GB`, file.path)
  }
  return {
    name: basename(file.path),
    bytes: new Uint8Array(readFileSync(file.path)),
    ...(file.password ? { password: file.password } : {}),
  }
}

/** "name.pdf", "name (2).pdf", "name (3).pdf" … the first that does not exist. */
export function freePath(dir: string, name: string, taken: ReadonlySet<string> = new Set()) {
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let i = 1; ; i++) {
    const candidate = join(dir, i === 1 ? name : `${base} (${i})${ext}`)
    if (!existsSync(candidate) && !taken.has(candidate)) return candidate
  }
}

/** Write via a temporary name so a crash never leaves half a file under the real one. */
function writeAtomic(path: string, bytes: Uint8Array) {
  const part = `${path}.part`
  writeFileSync(part, bytes)
  renameSync(part, path)
}

/**
 * Write a tool's outputs into `dir`. More than one output from a single input
 * (split, page images) goes into its own sub-folder so a 300-page render does
 * not bury the folder it came from.
 */
function writeOutputs(
  dir: string,
  outputs: readonly ToolOutput[],
  groupName: string,
): ToolOutputFile[] {
  let target = dir
  if (outputs.length > 1) {
    target = freePath(dir, groupName)
    mkdirSync(target, { recursive: true })
  }
  const written: ToolOutputFile[] = []
  const taken = new Set<string>()
  for (const out of outputs) {
    const path = freePath(target, out.name, taken)
    taken.add(path)
    writeAtomic(path, out.bytes)
    written.push({ path, size: out.bytes.length })
  }
  return written
}

/** How the worker lets the user stop a run; without it a run goes to the end. */
export interface JobControl {
  canceled(): boolean
  /** About to write outputs: false when the run was canceled instead. */
  beginWrite(): boolean
  endWrite(): void
}

/** What a run needs besides MuPDF. */
export interface JobDeps {
  /** the system OCR engine, when this computer has one */
  ocr?: OcrRecognizer | null
  control?: JobControl
  /** each input's result as soon as it is done, before the run ends */
  onItem?: (item: ToolResultItem) => void
}

/** Unwinds a run the user stopped; never reported as an error. */
class Canceled extends Error {}

/**
 * Write and report unless the run was stopped; false when it was. The runner
 * never stops the thread inside this window, so no file is cut in half and
 * every file written is reported.
 */
function guardedWrite(deps: JobDeps, write: () => void): boolean {
  const c = deps.control
  if (c && !c.beginWrite()) return false
  try {
    write()
  } finally {
    c?.endWrite()
  }
  return true
}

function runOne(
  m: Mupdf,
  req: ToolRequest,
  input: ToolInput,
  deps: JobDeps,
  onProgress: (done: number, total: number) => void,
): ToolOutput[] {
  switch (req.tool) {
    case 'split':
      return splitPdf(m, input, req.options)
    case 'extract':
      return [extractPages(m, input, req.options.pages)]
    case 'delete':
      return [deletePages(m, input, req.options.pages)]
    case 'rotate':
      return [rotatePages(m, input, req.options.angle, req.options.pages)]
    case 'reorder':
      return [reorderPages(m, input, req.options.order)]
    case 'compress':
      return [compressPdf(m, input, COMPRESS_PRESETS[req.options.level])]
    case 'pdf-to-images':
      return pdfToImages(m, input, req.options)
    case 'extract-images':
      return extractImages(m, input)
    case 'protect':
      return [
        protectPdf(m, input, {
          userPassword: req.options.userPassword,
          ownerPassword: req.options.ownerPassword,
          permissions: {
            ...ALL_PERMISSIONS,
            print: req.options.allowPrint,
            copy: req.options.allowCopy,
            edit: req.options.allowEdit,
            annotate: req.options.allowEdit,
            assemble: req.options.allowEdit,
          },
        }),
      ]
    case 'unlock':
      return [unlockPdf(m, input)]
    case 'watermark':
      return [addWatermark(m, input, req.options)]
    case 'page-numbers':
      return [addPageNumbers(m, input, req.options)]
    case 'flatten':
      return [flattenPdf(m, input)]
    case 'repair':
      return [repairPdf(m, input)]
    case 'properties':
      return [writeMetadata(m, input, req.options)]
    case 'ocr':
      if (!deps.ocr) {
        throw new PdfToolError(
          'unsupported',
          'text recognition is not available on this computer; it needs Windows 10 or 11 with an OCR language installed',
          input.name,
        )
      }
      return [ocrPdf(m, input, deps.ocr, req.options, onProgress)]
    case 'merge':
    case 'images-to-pdf':
      throw new Error(`${req.tool} combines its inputs`)
  }
}

const GROUP_SUFFIX: Partial<Record<ToolRequest['tool'], string>> = {
  split: 'split',
  'pdf-to-images': 'pages',
  'extract-images': 'images',
}

export function runRequest(
  m: Mupdf,
  req: ToolRequest,
  onProgress: (progress: ToolProgress) => void = () => {},
  deps: JobDeps = {},
): ToolResult {
  if (req.files.length === 0) {
    return { ok: false, error: { code: 'bad-input', message: 'add at least one file' } }
  }
  const total = req.files.length
  const outDir = (file: string) => req.outputDir ?? dirname(file)
  const items: ToolResultItem[] = []
  const finish = (item: ToolResultItem) => {
    items.push(item)
    deps.onItem?.(item)
  }
  const stopped = (): ToolResult => ({ ok: true, items, canceled: true })
  // canceled while it waited behind another request
  if (deps.control?.canceled()) return stopped()

  if (COMBINING_TOOLS.has(req.tool)) {
    const first = req.files[0].path
    try {
      const inputs = req.files.map((f) => ({ ...readInput(f), pages: f.pages }))
      const out =
        req.tool === 'merge'
          ? mergePdfs(m, inputs)
          : imagesToPdf(m, inputs, (req as Extract<ToolRequest, { tool: 'images-to-pdf' }>).options)
      const write = () =>
        finish({ source: first, outputs: writeOutputs(outDir(first), [out], out.name) })
      if (!guardedWrite(deps, write)) return stopped()
      onProgress({ done: total, total })
      return { ok: true, items }
    } catch (err) {
      return { ok: false, error: toToolError(err, first) }
    }
  }

  for (const [i, file] of req.files.entries()) {
    if (deps.control?.canceled()) return stopped()
    try {
      const input = readInput(file)
      // OCR reports pages too, since one scanned file can take minutes
      const onPage = (pagesDone: number, pagesTotal: number) => {
        if (deps.control?.canceled()) throw new Canceled()
        onProgress({ done: i, total, pagesDone, pagesTotal })
      }
      const outputs = runOne(m, req, input, deps, onPage)
      if (outputs.length === 0) {
        finish({
          source: file.path,
          outputs: [],
          error: { code: 'bad-input', message: 'nothing to save', file: file.path },
        })
      } else {
        const group = `${stem(input.name)}-${GROUP_SUFFIX[req.tool] ?? 'output'}`
        const write = () =>
          finish({
            source: file.path,
            outputs: writeOutputs(outDir(file.path), outputs, group),
            ...(req.tool === 'compress' ? { originalSize: input.bytes.length } : {}),
          })
        if (!guardedWrite(deps, write)) return stopped()
      }
    } catch (err) {
      if (err instanceof Canceled) return stopped()
      finish({ source: file.path, outputs: [], error: toToolError(err, file.path) })
    }
    onProgress({ done: i + 1, total })
  }
  return { ok: true, items }
}

const IMAGE_RE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i')

export function fileInfo(m: Mupdf, path: string, password?: string): FileInfo {
  try {
    const size = statSync(path).size
    if (IMAGE_RE.test(path)) return { ok: true, kind: 'image', size }
    const input = readInput({ path, ...(password ? { password } : {}) })
    const info = pdfInfo(m, input)
    return {
      ok: true,
      kind: 'pdf',
      pages: info.pages,
      encrypted: info.encrypted,
      size,
      metadata: readMetadata(m, input),
    }
  } catch (err) {
    return { ok: false, error: toToolError(err, path) }
  }
}
