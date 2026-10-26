/**
 * The PDF tools area on Home: the renderer names files by path and the main
 * process runs the tool in a worker thread (src/main/pdf-tools), writing the
 * results to disk. Nothing leaves the machine.
 */

export type ToolId =
  | 'merge'
  | 'split'
  | 'extract'
  | 'delete'
  | 'rotate'
  | 'reorder'
  | 'compress'
  | 'images-to-pdf'
  | 'pdf-to-images'
  | 'extract-images'
  | 'protect'
  | 'unlock'
  | 'watermark'
  | 'page-numbers'
  | 'flatten'
  | 'repair'
  | 'properties'
  | 'ocr'

export const TOOL_IDS: readonly ToolId[] = [
  'merge',
  'split',
  'extract',
  'delete',
  'rotate',
  'reorder',
  'compress',
  'images-to-pdf',
  'pdf-to-images',
  'extract-images',
  'protect',
  'unlock',
  'watermark',
  'page-numbers',
  'flatten',
  'repair',
  'properties',
  'ocr',
]

/** Tools that combine every input into one output; the rest run once per file. */
export const COMBINING_TOOLS: ReadonlySet<ToolId> = new Set(['merge', 'images-to-pdf'])

/** Tools whose inputs are images rather than PDFs. */
export const IMAGE_INPUT_TOOLS: ReadonlySet<ToolId> = new Set(['images-to-pdf'])

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp'] as const

export interface ToolFile {
  path: string
  /** open password of an encrypted PDF */
  password?: string
  /** page-range expression for this file (merge) */
  pages?: string
}

export interface ToolOptions {
  merge: Record<string, never>
  split:
    | { kind: 'every'; size: number }
    | { kind: 'ranges'; ranges: string }
    | { kind: 'pages'; pages: string }
  extract: { pages: string }
  delete: { pages: string }
  rotate: { angle: 90 | 180 | 270; pages: string }
  reorder: { order: string }
  compress: { level: 'strong' | 'balanced' | 'light' }
  'images-to-pdf': {
    pageSize: 'fit' | 'a4' | 'letter' | 'legal' | 'a3' | 'a5'
    orientation: 'auto' | 'portrait' | 'landscape'
    margin: number
  }
  'pdf-to-images': { format: 'png' | 'jpeg'; dpi: number; quality: number; pages: string }
  'extract-images': Record<string, never>
  protect: {
    userPassword: string
    ownerPassword: string
    allowPrint: boolean
    allowCopy: boolean
    allowEdit: boolean
  }
  unlock: Record<string, never>
  watermark: {
    text: string
    fontSize: number
    color: string
    opacity: number
    rotation: number | 'diagonal'
    position: 'center' | 'top' | 'bottom'
    pages: string
  }
  'page-numbers': {
    format: string
    position:
      'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left'
    fontSize: number
    margin: number
    firstNumber: number
    pages: string
  }
  flatten: Record<string, never>
  repair: Record<string, never>
  properties: { title?: string; author?: string; subject?: string; keywords?: string }
  /** recognize text on scanned pages; empty pages means every page */
  ocr: { pages: string }
}

export type ToolRequest = {
  [T in ToolId]: {
    tool: T
    files: ToolFile[]
    options: ToolOptions[T]
    /** folder for the results; absent means beside each input file */
    outputDir?: string
  }
}[ToolId]

export type ToolErrorCode =
  | 'password-required'
  | 'wrong-password'
  | 'not-pdf'
  | 'damaged'
  | 'bad-input'
  | 'bad-pages'
  | 'unsupported'
  | 'io'
  | 'failed'

export interface ToolError {
  code: ToolErrorCode
  message: string
  /** input path the error is about */
  file?: string
}

export interface ToolOutputFile {
  path: string
  size: number
}

export interface ToolResultItem {
  /** the input this result came from (the first input for combining tools) */
  source: string
  outputs: ToolOutputFile[]
  /** compress: size before */
  originalSize?: number
  error?: ToolError
}

export type ToolResult =
  | {
      ok: true
      /** one per input finished, in input order (a canceled run lists the ones done before it stopped) */
      items: ToolResultItem[]
      /** the user stopped the run; inputs after the last item were not touched */
      canceled?: boolean
    }
  | { ok: false; error: ToolError }

export type FileInfo =
  | {
      ok: true
      kind: 'pdf'
      pages: number
      encrypted: boolean
      size: number
      metadata: { title?: string; author?: string; subject?: string; keywords?: string }
    }
  | { ok: true; kind: 'image'; size: number }
  | { ok: false; error: ToolError }

export interface ToolProgress {
  /** input files finished so far; the one being worked on is `done` (0-based) */
  done: number
  total: number
  /** OCR: pages of the current file recognized so far, out of `pagesTotal` */
  pagesDone?: number
  pagesTotal?: number
}

export interface PdfToolsApi {
  /** native open dialog; PDFs or images */
  pickFiles(kind: 'pdf' | 'image', multiple: boolean): Promise<string[]>
  pickFolder(): Promise<string | null>
  /** page count / encryption for the file list; checks the password when given */
  info(path: string, password?: string): Promise<FileInfo>
  run(request: ToolRequest): Promise<ToolResult>
  /**
   * Stop this window's running request. It ends at the next file or page, or
   * at once when one step is long; outputs already written are kept and a
   * half-written file is never left behind. run() then resolves with
   * `canceled: true`.
   */
  cancel(): Promise<void>
  onProgress(handler: (progress: ToolProgress) => void): () => void
  /** path of a File dropped on the tools panel (Electron hides it from the DOM) */
  pathForFile(file: File): string
}

export const PDF_TOOLS_CHANNELS = {
  pickFiles: 'pdf-tools:pick-files',
  pickFolder: 'pdf-tools:pick-folder',
  info: 'pdf-tools:info',
  run: 'pdf-tools:run',
  cancel: 'pdf-tools:cancel',
  progress: 'pdf-tools:progress',
} as const
