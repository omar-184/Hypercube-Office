import type { HeadlessExportTarget } from '@genoffice/electron-utils/headless-export'
import type { Lang } from '@genoffice/i18n'

export const HTML_CHANNELS = {
  consumePending: 'html:consume-pending',
  previewUpdate: 'html:preview-update',
  previewInfo: 'html:preview-info',
  previewAllowRemote: 'html:preview-allow-remote',
  presentFullScreen: 'html:present-fullscreen',
  presentNewTab: 'html:present-new-tab',
  readFile: 'html:read-file',
  save: 'html:save',
  saveRequest: 'html:save-request',
  saveRequestAck: 'html:save-request-ack',
  dirtyChanged: 'html:dirty-changed',
  closeSaveRequest: 'html:close-save-request',
  closeSaveResult: 'html:close-save-result',
  fileRenamed: 'html:file-renamed',
  pickImage: 'html:pick-image',
  saveImage: 'html:save-image',
  readImage: 'html:read-image',
  fetchImage: 'html:fetch-image',
  exportRequest: 'html:export-request',
  exportDocx: 'html:export-docx',
  exportPdf: 'html:export-pdf',
  exportHtml: 'html:export-html',
  consumeHeadlessExport: 'html:consume-headless-export',
  headlessExportDone: 'html:headless-export-done',
  printRequest: 'html:print-request',
  printHtml: 'html:print-html',
  getLanguage: 'app:get-language',
  languageChanged: 'app:language-changed',
  getTheme: 'app:get-theme',
  themeChanged: 'app:theme-changed',
  getAutoSaveDefault: 'app:get-auto-save-default',
  autoSaveDefaultChanged: 'app:auto-save-default-changed',
} as const

export type UiTheme = 'light' | 'dark' | 'system'

/** shell-wide AutoSave default; updatedAt is 0 until the user has ever set it */
export interface AutoSaveDefault {
  on: boolean
  updatedAt: number
}

export type SaveMode = 'save' | 'saveAs'

export interface SaveHtmlRequest {
  /** full document text (frontmatter included) */
  text: string
  /** Authored image paths in document order; the main process validates every path. */
  imageSources: string[]
  mode: SaveMode
}

export type SaveHtmlResult =
  | {
      ok: true
      path: string
      /** Save As may relocate local images into the new document's assets directory. */
      imageRewrites?: Array<{ from: string; to: string }>
    }
  | { ok: true; canceled: true }
  | { ok: false; error: string }

export type ExportFormat = 'pdf' | 'docx' | 'html'

/** Word export: html2docx renders the document in a hidden window and writes native OOXML; the result opens in Docs */
export interface ExportDocxRequest {
  /** the document text */
  html: string
  /** file name (no extension) suggested in the dialog */
  suggestedName: string
  /** headless export mode only: write here instead of opening the save dialog */
  outPath?: string
}

export interface ExportPdfRequest {
  /** self-contained print HTML */
  html: string
  suggestedName: string
  /** headless export mode only: write here instead of opening the save dialog */
  outPath?: string
}

/** Single-file HTML export: local image references inlined as data URLs; opens without the assets/ folder */
export interface ExportHtmlRequest {
  /** the document text */
  html: string
  suggestedName: string
  /** headless export mode only: write here instead of opening the save dialog */
  outPath?: string
}

export type ExportResult =
  | { ok: true; path: string; skipped?: string[] }
  | { ok: true; canceled: true }
  | { ok: false; error: string }

/** Shell menu Print: the renderer hands over the document text, main opens the system dialog */
export interface PrintHtmlRequest {
  /** the document text */
  html: string
}

/** A cancelled job is the user closing the system dialog: an outcome, not a failure,
 * so it must stay silent. Mirrors the `canceled` variant ExportResult already uses. */
export type PrintResult = { ok: true } | { ok: true; canceled: true } | { ok: false; error: string }

export interface ImageData {
  base64: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif'
}

/** API exposed by preload to the renderer (window.htmlApi) */
export interface HtmlApi {
  /** Take the md path pending for this view (queued at tab creation); null = new untitled document */
  consumePending(): Promise<string | null>
  /** Headless export mode: the path and format this hidden renderer must export, null in normal use */
  consumeHeadlessExport(): Promise<HeadlessExportTarget | null>
  /** Headless export mode: report the export outcome so the main process can quit */
  headlessExportDone(result: { ok: boolean; error?: string }): void
  /** Read the file as UTF-8 text. Only paths granted to this view are allowed */
  readFile(path: string): Promise<string>
  /** Push the current buffer so html-preview:// serves it to the preview iframe */
  updatePreview(text: string): void
  /** The html-preview:// URL bound to this view (a present tab gets its owner's URL) */
  /** allowRemote: the user already chose Load web content for this view (or its owner) */
  getPreviewInfo(): Promise<{ url: string; allowRemote: boolean }>
  /** Load the document's web content in this tab's preview (blocked by default) */
  allowRemoteContent(): Promise<void>
  /** Present → Fullscreen: cover the screen in one main-side call (tab-strip bleed, macOS simpleFullScreen) */
  setPresentFullScreen(on: boolean): Promise<void>
  /** Present → New tab: a chrome-free tab (shell) or window (standalone) showing this view's preview */
  presentInNewTab(title: string): Promise<boolean>
  /**
   * Write the document text. With a granted file path the write is atomic
   * (tmp + rename); untitled documents and mode 'saveAs' go through a main-process
   * save dialog first. The resolved path is granted to the view and returned.
   */
  save(request: SaveHtmlRequest): Promise<SaveHtmlResult>
  /** Mirror unsaved-changes state to the main process; drives the save prompt before closing a tab/window */
  setDirty(dirty: boolean): void
  /** Shell menu Save / Save As → renderer serializes and calls save() with the given mode */
  onSaveRequest(handler: (mode: SaveMode) => void): () => void
  /** Resolves a menu-save waiter when doSave exits without ever invoking save() (busy/loading) */
  sendSaveRequestAck(ok: boolean): void
  /** Main process picked "Save" in the close prompt → renderer saves and replies via sendCloseSaveResult */
  onCloseSaveRequest(handler: () => void): () => void
  sendCloseSaveResult(ok: boolean): void
  /** The file was renamed on disk (Home list rename) — renderer syncs its display path */
  onFileRenamed(handler: (newPath: string) => void): () => void
  /**
   * Pick an image file and copy it into `assets/` next to the open document;
   * returns the relative path to author into the html, or null when the
   * document is untitled or the picker was canceled.
   */
  pickImage(): Promise<string | null>
  /**
   * Persist pasted/dropped image bytes into `assets/` next to the open
   * document; returns the relative path to author, or null when untitled.
   */
  saveImage(data: { base64: string; ext: string }): Promise<string | null>
  /**
   * Read an image referenced by the document for DOCX embedding. Only paths
   * inside the document's directory are allowed; anything else returns null.
   */
  readImage(src: string): Promise<ImageData | null>
  /** Shell menu export → renderer serializes and calls exportDocx/exportPdf */
  onExportRequest(handler: (format: ExportFormat) => void): () => void
  /** Shell menu Print → renderer builds the print HTML and opens the system print dialog */
  onPrintRequest(handler: () => void): () => void
  exportDocx(request: ExportDocxRequest): Promise<ExportResult>
  exportPdf(request: ExportPdfRequest): Promise<ExportResult>
  exportHtml(request: ExportHtmlRequest): Promise<ExportResult>
  /** Shell menu Print → main renders the document and opens the system print dialog */
  printHtml(request: PrintHtmlRequest): Promise<PrintResult>
  getLanguage(): Promise<Lang>
  onLanguageChanged(handler: (lang: Lang) => void): () => void
  getTheme(): Promise<UiTheme>
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  getAutoSaveDefault(): Promise<AutoSaveDefault>
  onAutoSaveDefaultChanged(handler: (value: AutoSaveDefault) => void): () => void
  /** press on the shell chrome (tab strip is a sibling WebContentsView whose
   *  clicks produce no DOM event here) — dismiss open popovers */
  onChromePressed(handler: () => void): () => void
  /** Download an image URL in the main process (CORS-free, scheme/target validated) */
  fetchImage(url: string): Promise<ImageData | null>
}
