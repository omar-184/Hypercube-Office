import type { PerfProgress, PerfReport } from './perf-check'

/** UI language; kept self-contained here (mirrors Lang in @genoffice/i18n) */
export type UiLanguage =
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'th'
  | 'id'
  | 'ru'
  | 'ar'
  | 'pt'
  | 'it'
  | 'pl'
  | 'cs'
  | 'nl'
  | 'ms'
  | 'he'
  | 'hi'
  | 'zh-TW'
  | 'vi'

/** UI theme preference */
export type UiTheme = 'light' | 'dark' | 'system'

/**
 * Document page theme preference (#1811): what the editors' canvas/paper does
 * relative to the UI theme. 'follow' reproduces the previous single-theme
 * behavior; 'light'/'dark' pin the paper regardless of the UI theme.
 */
export type DocTheme = 'follow' | 'light' | 'dark'

/** the legal texts shipped with the app: the AGPL-3.0 license, or the third-party notices */
export type LegalNotice = 'license' | 'notices'

/** shell-wide AutoSave default for every editor; updatedAt is 0 until first set */
export interface AutoSaveDefault {
  on: boolean
  updatedAt: number
}

/** a recent file entry shown on the home screen; type derives from the extension */
export interface RecentEntry {
  path: string
  name: string
  /** lowercased extension without the dot ('docx' | 'xlsx' | 'pptx') */
  ext: string
  /** last-modified time, ms since epoch */
  mtimeMs: number
  /** file size in bytes */
  sizeBytes: number
  /** whether the user starred this file */
  starred: boolean
  /** the path failed to stat (disconnected drive, moved, deleted) — kept
      listed like Word's recents instead of silently dropped (r158) */
  missing?: boolean
}

/** paged query for the home file lists */
export interface RecentQuery {
  /** number of entries to skip (default 0) */
  offset?: number
  /** page size; 0 returns no entries but still reports totals (default 50) */
  limit?: number
  /** restrict to one extension ('docx' | 'xlsx' | 'pptx'); omit for all */
  ext?: string
}

export interface RecentPage {
  entries: RecentEntry[]
  /** total matching the query's ext filter */
  total: number
  /** total ignoring the ext filter (for the sidebar counters) */
  totalAll: number
}

/** local file search over names, folders and extracted text */
export interface FileSearchQuery {
  q: string
  /** sidebar filter key ('docx' | 'xlsx' | ...); omit for all */
  ext?: string
  offset?: number
  limit?: number
}

export interface FileSearchSnippetPart {
  text: string
  hit: boolean
}

export interface FileSearchHit extends RecentEntry {
  /** excerpt around the first content match; null when only the name or folder matched */
  snippet: FileSearchSnippetPart[] | null
  /** folded query fragments the file matched; highlight them in the name and folder */
  needles: string[]
}

export interface FileSearchPage {
  hits: FileSearchHit[]
  total: number
  index: {
    indexed: number
    pending: number
    scanning: boolean
  }
}

/**
 * Default-app ownership of the Office document types. `others` lists the apps
 * (display names) currently holding at least one type; `manualOnly` means the
 * platform (Windows) only lets us open the system page.
 */
export interface DefaultAppStatus {
  state: 'unsupported' | 'unknown' | 'default' | 'other'
  others: string[]
  manualOnly: boolean
}

export type UpdateCheckState = 'latest' | 'available' | 'failed'

/** outcome of one opt-in update check (main/update-check.ts) */
export interface UpdateCheckResult {
  state: UpdateCheckState
  /** latest published version, without the leading "v" */
  version?: string
  /** release page to open for 'available' */
  url?: string
  checkedAt: number
}

export interface UpdateCheckStatus {
  /** background check, off by default; while false only "Check now" makes a request */
  enabled: boolean
  last: UpdateCheckResult | null
}

/**
 * In-app download and install of a newer release (main/update-install.ts).
 * 'unsupported': this build cannot install updates itself (not a packaged
 * Windows build, or the release has no verifiable installer); the release
 * page is the fallback.
 */
export type UpdateInstallState = 'unsupported' | 'idle' | 'downloading' | 'ready' | 'failed'

export interface UpdateInstallStatus {
  state: UpdateInstallState
  /** version being downloaded or ready to install */
  version?: string
  /** bytes received so far and the expected total (0 when unknown) */
  received: number
  total: number
}

export interface HomeApi {
  /** unified recents across document types, newest first (paged) */
  recents(query?: RecentQuery): Promise<RecentPage>
  /** search indexed files by name, folder and content */
  searchFiles(query: FileSearchQuery): Promise<FileSearchPage>
  /** starred files (independent of the recent list), newest first (paged) */
  starred(query?: RecentQuery): Promise<RecentPage>
  /** stat a specific set of paths (project view); unstat-able files come back flagged `missing` */
  statPaths(paths: string[]): Promise<RecentEntry[]>
  /** star / unstar a file */
  toggleStar(path: string): Promise<void>
  /** open an existing file, routing to the right module by extension */
  openPath(path: string): Promise<void>
  /** file picker accepting every supported extension, then routes */
  browse(): Promise<void>
  /** open a docs window at its start screen; `dir` = folder the first save should land in */
  newDoc(opts?: NewFileOpts): Promise<void>
  /** open a sheets window */
  newSheet(opts?: NewFileOpts): Promise<void>
  /** open a slides tab at its start screen (open-a-pptx) */
  newSlide(opts?: NewFileOpts): Promise<void>
  /** open a blank markdown editor tab */
  newMarkdown(opts?: NewFileOpts): Promise<void>
  /** open a blank html editor tab */
  newHtml(opts?: NewFileOpts): Promise<void>
  /** create a blank single-page PDF in the default save folder and open it */
  newPdf(opts?: NewFileOpts): Promise<void>
  /** copy a starter file into the default save folder (or `dir`) and open it */
  newFromTemplate(id: HomeTemplateId, opts?: NewFileOpts): Promise<void>
  /** drop entries from the recent list (does not touch the files) */
  removeRecent(paths: string[]): Promise<void>
  /** reveal the file in Finder / Explorer */
  revealPath(path: string): Promise<void>
  /** rename the file on disk (same directory) and update the recent list */
  renameFile(path: string, newName: string): Promise<RenameResult>
  /** copy the file next to itself (localized "copy" suffix before .ext) and record it as recent */
  duplicateFile(path: string): Promise<void>
  /** move files to the trash and drop them from the recent list */
  deleteFiles(paths: string[]): Promise<void>
  /** open the OS trash, where deleted files can be restored */
  openTrash(): Promise<void>
  /** the tree roots: the default save folder first, then the folders the user added */
  folderRoots(): Promise<FolderRoot[]>
  /** directory picker; the chosen folder joins the tree in place (nothing is copied or moved) */
  addFolderRoot(): Promise<FolderRoot | null>
  /** OS paths dropped on the Folders panel: folders join the tree, documents open */
  dropFolderRoots(paths: string[]): Promise<FolderRoot[]>
  /** take an added folder off the list; the disk is untouched */
  removeFolderRoot(path: string): Promise<void>
  /** absolute path of a File from an OS drag (Electron webUtils) */
  pathForFile(file: File): string
  /** one level of the tree: sub-folders + supported files directly inside `dir` */
  listFolder(dir: string): Promise<FolderListing>
  /** create `parent/name`; resolves to the new path */
  createFolder(parent: string, name: string): Promise<RenameResult>
  /** rename a folder in place (files inside keep their recents and stars) */
  renameFolder(dir: string, newName: string): Promise<RenameResult>
  /** move files and/or folders into `targetDir` */
  movePaths(paths: string[], targetDir: string, onConflict: MoveConflictPolicy): Promise<MoveResult>
  /** move a folder (and everything inside) to the trash */
  deleteFolder(dir: string): Promise<void>
  /** a folder under the root changed on disk (created/renamed/deleted/moved, from anywhere) */
  onFolderChanged(handler: (dirs: string[]) => void): () => void
  /** current UI language (persisted in userData/app-settings.json) */
  getLanguage(): Promise<UiLanguage>
  /** switch + persist the UI language; main rebuilds its menus to match */
  setLanguage(lang: UiLanguage): Promise<void>
  /** app version (from package.json / electron app.getVersion) */
  getAppVersion(): Promise<string>
  /** current UI theme preference (persisted in userData/app-settings.json) */
  getTheme(): Promise<UiTheme>
  /** switch + persist the UI theme; broadcasts 'app:theme-changed' to all web contents */
  setTheme(theme: UiTheme): Promise<void>
  /** current document page theme preference (#1811, persisted in userData/app-settings.json) */
  getDocumentTheme(): Promise<DocTheme>
  /** switch + persist the document page theme; broadcasts 'app:document-theme-changed' to all web contents */
  setDocumentTheme(theme: DocTheme): Promise<void>
  /** AutoSave default applied by every editor window (persisted in userData/app-settings.json) */
  getAutoSaveDefault(): Promise<AutoSaveDefault>
  /** persist the AutoSave default; broadcasts 'app:auto-save-default-changed' to all web contents */
  setAutoSaveDefault(on: boolean): Promise<void>
  /** effective default save folder for new/untitled files (configured in userData/app-settings.json, falls back to <Documents>/Hypercube Office) */
  getDefaultSaveDir(): Promise<string>
  /** directory picker to change the default save folder; resolves to the new folder, or null when canceled or the pick was unusable */
  pickDefaultSaveDir(): Promise<string | null>
  /** who opens .docx/.xlsx/.pptx today (Settings → General "default app" row) */
  getDefaultAppStatus(): Promise<DefaultAppStatus>
  /** claim the Office types (mac/linux) or open the system Default Apps page (win); resolves to the refreshed status */
  setDefaultApp(): Promise<DefaultAppStatus>
  /** theme switched anywhere (broadcast from the main process) */
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  /** document page theme switched anywhere (broadcast from the main process) */
  onDocumentThemeChanged(handler: (theme: DocTheme) => void): () => void
  /** open the public GitHub repository in the default browser */
  openGitHubRepo(): Promise<void>
  /** open a shipped legal text in the system's text viewer; false when it could not be opened */
  openLegalNotice(which: LegalNotice): Promise<boolean>
  /** opt-in update check setting and the last result this session */
  getUpdateCheck(): Promise<UpdateCheckStatus>
  /** turn the opt-in update check on or off (persisted in userData/app-settings.json) */
  setUpdateCheck(enabled: boolean): Promise<void>
  /** ask GitHub for the latest release now (an explicit user action, so it works with the background check off) */
  checkForUpdates(): Promise<UpdateCheckResult>
  /** open the release page of the last 'available' result in the browser */
  openUpdatePage(): Promise<void>
  /** whether the last 'available' release can be downloaded and installed in-app, and how far that got */
  getUpdateInstall(): Promise<UpdateInstallStatus>
  /** download the last 'available' installer and verify its SHA-256; resolves when done or failed */
  downloadUpdate(): Promise<UpdateInstallStatus>
  /** ask to confirm, then quit and run the verified installer; false when cancelled or not ready */
  installUpdate(): Promise<boolean>
  /** download progress (broadcast from the main process) */
  onUpdateInstallProgress(handler: (status: UpdateInstallStatus) => void): () => void
  /** Settings → Performance: the last offline self-test this session, null before the first */
  getPerfCheck(): Promise<PerfReport | null>
  /** run the offline self-test (main/perf-check.ts); a call while one runs joins it */
  runPerfCheck(): Promise<PerfReport>
  /** step updates while the self-test runs */
  onPerfCheckProgress(handler: (progress: PerfProgress) => void): () => void
  /** copy the plain-text report of the last run; false when there is none */
  copyPerfReport(): Promise<boolean>
}

export interface RenameResult {
  ok: boolean
  /** the new absolute path when ok */
  path?: string
  error?: string
}

export interface NewFileOpts {
  /** folder the new file's first save should land in (defaults to the save folder root) */
  dir?: string
}

// ── Folder tree (home "Folders" panel: the default save folder plus any folder the user added) ──

export interface FolderRoot {
  path: string
  /** folder name shown on the root row */
  name: string
  /** false when the folder does not exist and cannot be created, or is read-only */
  usable: boolean
  /** the folder exists and can be listed (a read-only or unplugged root is still shown) */
  readable: boolean
  /** an added folder: can be taken off the list; the default save folder cannot */
  removable: boolean
}

export interface FolderEntry {
  path: string
  name: string
  mtimeMs: number
  /** whether it contains at least one visible sub-folder (drives the expand chevron) */
  hasSubfolders: boolean
}

/** a document file listed by the tree (same shape as the home recents rows) */
export interface FileEntry {
  path: string
  name: string
  /** lowercased extension without the dot */
  ext: string
  mtimeMs: number
  sizeBytes: number
  starred: boolean
  /** the path failed to stat */
  missing?: boolean
}

export interface FolderListing {
  dir: string
  folders: FolderEntry[]
  /** supported document files directly inside `dir`, newest first */
  files: FileEntry[]
  /** the directory could not be read (deleted or moved outside the app) */
  missing?: boolean
}

/** what to do when a moved item's name already exists in the target */
export type MoveConflictPolicy = 'ask' | 'replace' | 'keepBoth' | 'skip'

export interface MoveResult {
  /** old path → new path for everything that moved */
  moved: Array<{ from: string; to: string }>
  /** items skipped because the name exists in the target (policy 'ask'/'skip') */
  conflicts: string[]
  /** items that failed for another reason */
  failed: Array<{ path: string; error: string }>
}

/** Starter files offered under Home ▸ Templates */
export const HOME_TEMPLATE_IDS = ['letter', 'resume', 'budget', 'invoice', 'presentation'] as const
export type HomeTemplateId = (typeof HOME_TEMPLATE_IDS)[number]

export const HOME_CHANNELS = {
  recents: 'home:recents',
  searchFiles: 'home:search-files',
  starred: 'home:starred',
  statPaths: 'home:stat-paths',
  toggleStar: 'home:toggle-star',
  openPath: 'home:open-path',
  browse: 'home:browse',
  newDoc: 'home:new-doc',
  newSheet: 'home:new-sheet',
  newSlide: 'home:new-slide',
  newMarkdown: 'home:new-markdown',
  newHtml: 'home:new-html',
  newPdf: 'home:new-pdf',
  newFromTemplate: 'home:new-from-template',
  removeRecent: 'home:remove-recent',
  revealPath: 'home:reveal-path',
  renameFile: 'home:rename-file',
  duplicateFile: 'home:duplicate-file',
  deleteFiles: 'home:delete-files',
  openTrash: 'home:open-trash',
  folderRoots: 'home:folder-roots',
  addFolderRoot: 'home:folder-root-add',
  dropFolderRoots: 'home:folder-root-drop',
  removeFolderRoot: 'home:folder-root-remove',
  listFolder: 'home:folder-list',
  createFolder: 'home:folder-create',
  renameFolder: 'home:folder-rename',
  movePaths: 'home:move-paths',
  deleteFolder: 'home:folder-delete',
  folderChanged: 'home:folder-changed',
  getLanguage: 'home:get-language',
  setLanguage: 'home:set-language',
  getAppVersion: 'home:get-app-version',
  getTheme: 'home:get-theme',
  setTheme: 'home:set-theme',
  getDocumentTheme: 'home:get-document-theme',
  setDocumentTheme: 'home:set-document-theme',
  getAutoSaveDefault: 'home:get-auto-save-default',
  setAutoSaveDefault: 'home:set-auto-save-default',
  getDefaultSaveDir: 'home:get-default-save-dir',
  getDefaultAppStatus: 'home:get-default-app-status',
  setDefaultApp: 'home:set-default-app',
  pickDefaultSaveDir: 'home:pick-default-save-dir',
  openGitHubRepo: 'home:open-github-repo',
  openLegalNotice: 'home:open-legal-notice',
  getUpdateCheck: 'home:get-update-check',
  setUpdateCheck: 'home:set-update-check',
  checkForUpdates: 'home:check-for-updates',
  openUpdatePage: 'home:open-update-page',
  getUpdateInstall: 'home:get-update-install',
  downloadUpdate: 'home:download-update',
  installUpdate: 'home:install-update',
  updateInstallProgress: 'home:update-install-progress',
  getPerfCheck: 'home:get-perf-check',
  runPerfCheck: 'home:run-perf-check',
  perfCheckProgress: 'home:perf-check-progress',
  copyPerfReport: 'home:copy-perf-report',
} as const
