import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { installDropOpenBridge } from '@genoffice/electron-utils/drop-open'
import { PERF_STEPS, type PerfProgress, type PerfReport } from '../shared/perf-check'
import type {
  DefaultAppStatus,
  UpdateCheckResult,
  UpdateInstallStatus,
  FolderListing,
  FolderRoot,
  MoveResult,
  HomeApi,
  RecentEntry,
  RecentPage,
  RenameResult,
  UiLanguage,
  FileSearchPage,
} from '../shared/home-api'
import { HOME_CHANNELS } from '../shared/home-api'
import type { TabsApi, TabSummary } from '../shared/tabs-api'
import type { PdfToolsApi, ToolProgress } from '../shared/pdf-tools-api'
import { PDF_TOOLS_CHANNELS } from '../shared/pdf-tools-api'
import { TABS_CHANNELS } from '../shared/tabs-api'

const UI_LANGUAGES: readonly UiLanguage[] = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'th',
  'id',
  'ru',
  'ar',
  'pt',
  'it',
  'pl',
  'cs',
  'nl',
  'ms',
  'he',
  'hi',
  'zh-TW',
  'vi',
]

function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage)
}

const EMPTY_PAGE: RecentPage = { entries: [], total: 0, totalAll: 0 }

function asRecentPage(result: unknown): RecentPage {
  if (result && typeof result === 'object' && Array.isArray((result as RecentPage).entries)) {
    return result as RecentPage
  }
  return EMPTY_PAGE
}

const EMPTY_SEARCH: FileSearchPage = {
  hits: [],
  total: 0,
  index: { indexed: 0, pending: 0, scanning: false },
}

function asSearchPage(result: unknown): FileSearchPage {
  if (result && typeof result === 'object' && Array.isArray((result as FileSearchPage).hits)) {
    return result as FileSearchPage
  }
  return EMPTY_SEARCH
}

function normalizeUpdateResult(result: unknown): UpdateCheckResult {
  const r = (result ?? {}) as Partial<UpdateCheckResult>
  const state = r.state === 'latest' || r.state === 'available' ? r.state : 'failed'
  return {
    state,
    version: typeof r.version === 'string' ? r.version : undefined,
    url: typeof r.url === 'string' ? r.url : undefined,
    checkedAt: typeof r.checkedAt === 'number' ? r.checkedAt : 0,
  }
}

const INSTALL_STATES = ['unsupported', 'idle', 'downloading', 'ready', 'failed'] as const

function normalizeInstallStatus(result: unknown): UpdateInstallStatus {
  const r = (result ?? {}) as Partial<UpdateInstallStatus>
  const state = INSTALL_STATES.find((s) => s === r.state) ?? 'unsupported'
  return {
    state,
    version: typeof r.version === 'string' ? r.version : undefined,
    received: typeof r.received === 'number' ? r.received : 0,
    total: typeof r.total === 'number' ? r.total : 0,
  }
}

function normalizeDefaultAppStatus(result: unknown): DefaultAppStatus {
  const r = (result ?? {}) as Partial<DefaultAppStatus>
  const state = r.state
  return {
    state: state === 'default' || state === 'other' || state === 'unknown' ? state : 'unsupported',
    others: Array.isArray(r.others) ? r.others.filter((x) => typeof x === 'string') : [],
    manualOnly: r.manualOnly === true,
  }
}

const homeApi: HomeApi = {
  async recents(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.recents, query))
  },
  async searchFiles(query) {
    return asSearchPage(await ipcRenderer.invoke(HOME_CHANNELS.searchFiles, query))
  },
  async starred(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.starred, query))
  },
  async statPaths(paths) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.statPaths, paths)
    return Array.isArray(result) ? (result as RecentEntry[]) : []
  },
  async toggleStar(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.toggleStar, path)
  },
  async openPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.openPath, path)
  },
  async browse() {
    await ipcRenderer.invoke(HOME_CHANNELS.browse)
  },
  async newDoc(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newDoc, opts)
  },
  async newSheet(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSheet, opts)
  },
  async newSlide(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSlide, opts)
  },
  async newMarkdown(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newMarkdown, opts)
  },
  async newHtml(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newHtml, opts)
  },
  async newPdf(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newPdf, opts)
  },
  async newFromTemplate(id, opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newFromTemplate, id, opts)
  },
  async removeRecent(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeRecent, paths)
  },
  async revealPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.revealPath, path)
  },
  async renameFile(path, newName) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.renameFile, path, newName)
    return (result ?? { ok: false, error: 'Rename failed' }) as RenameResult
  },
  async duplicateFile(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.duplicateFile, path)
  },
  async deleteFiles(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFiles, paths)
  },
  async folderRoots() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.folderRoots)) as FolderRoot[]
  },
  async addFolderRoot() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.addFolderRoot)) as FolderRoot | null
  },
  async dropFolderRoots(paths) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.dropFolderRoots, paths)) as FolderRoot[]
  },
  async removeFolderRoot(path) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeFolderRoot, path)
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file)
  },
  async listFolder(dir) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.listFolder, dir)) as FolderListing
  },
  async createFolder(parent, name) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.createFolder, parent, name)) as RenameResult
  },
  async renameFolder(dir, newName) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.renameFolder, dir, newName)) as RenameResult
  },
  async movePaths(paths, targetDir, onConflict) {
    return (await ipcRenderer.invoke(
      HOME_CHANNELS.movePaths,
      paths,
      targetDir,
      onConflict,
    )) as MoveResult
  },
  async deleteFolder(dir) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFolder, dir)
  },
  onFolderChanged(handler) {
    const listener = (_event: IpcRendererEvent, dirs: unknown) => {
      if (Array.isArray(dirs)) handler(dirs.filter((d): d is string => typeof d === 'string'))
    }
    ipcRenderer.on(HOME_CHANNELS.folderChanged, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.folderChanged, listener)
  },
  async openTrash() {
    await ipcRenderer.invoke(HOME_CHANNELS.openTrash)
  },
  async getLanguage() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getLanguage)
    return isUiLanguage(result) ? result : 'zh'
  },
  async setLanguage(lang) {
    if (!isUiLanguage(lang)) throw new Error('Invalid language.')
    await ipcRenderer.invoke(HOME_CHANNELS.setLanguage, lang)
  },
  async getAppVersion() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAppVersion)
    return typeof result === 'string' ? result : ''
  },
  async getTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getTheme)
    return result === 'dark' || result === 'light' ? result : 'system'
  },
  async setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system')
      throw new Error('Invalid theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setTheme, theme)
  },
  async getDocumentTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDocumentTheme)
    return result === 'dark' || result === 'light' ? result : 'follow'
  },
  async setDocumentTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'follow')
      throw new Error('Invalid document theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setDocumentTheme, theme)
  },
  async getAutoSaveDefault() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAutoSaveDefault)
    const r = result as { on?: unknown; updatedAt?: unknown } | null
    return {
      on: r?.on === true,
      updatedAt: typeof r?.updatedAt === 'number' ? r.updatedAt : 0,
    }
  },
  async setAutoSaveDefault(on) {
    if (typeof on !== 'boolean') throw new Error('Invalid AutoSave default.')
    await ipcRenderer.invoke(HOME_CHANNELS.setAutoSaveDefault, on)
  },
  async getDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDefaultSaveDir)
    return typeof result === 'string' ? result : ''
  },
  async getDefaultAppStatus() {
    return normalizeDefaultAppStatus(await ipcRenderer.invoke(HOME_CHANNELS.getDefaultAppStatus))
  },
  async setDefaultApp() {
    return normalizeDefaultAppStatus(await ipcRenderer.invoke(HOME_CHANNELS.setDefaultApp))
  },
  async pickDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.pickDefaultSaveDir)
    return typeof result === 'string' && result ? result : null
  },
  onThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'system') handler(theme)
    }
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  onDocumentThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'follow') handler(theme)
    }
    ipcRenderer.on('app:document-theme-changed', listener)
    return () => ipcRenderer.removeListener('app:document-theme-changed', listener)
  },
  async openGitHubRepo() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGitHubRepo)
  },
  async openLegalNotice(which) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.openLegalNotice, which)) === true
  },
  async getUpdateCheck() {
    const r = (await ipcRenderer.invoke(HOME_CHANNELS.getUpdateCheck)) as {
      enabled?: unknown
      last?: unknown
    } | null
    return {
      enabled: r?.enabled === true,
      last: r?.last ? normalizeUpdateResult(r.last) : null,
    }
  },
  async setUpdateCheck(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid update check setting.')
    await ipcRenderer.invoke(HOME_CHANNELS.setUpdateCheck, enabled)
  },
  async checkForUpdates() {
    return normalizeUpdateResult(await ipcRenderer.invoke(HOME_CHANNELS.checkForUpdates))
  },
  async openUpdatePage() {
    await ipcRenderer.invoke(HOME_CHANNELS.openUpdatePage)
  },
  async getUpdateInstall() {
    return normalizeInstallStatus(await ipcRenderer.invoke(HOME_CHANNELS.getUpdateInstall))
  },
  async downloadUpdate() {
    return normalizeInstallStatus(await ipcRenderer.invoke(HOME_CHANNELS.downloadUpdate))
  },
  async installUpdate() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.installUpdate)) === true
  },
  onUpdateInstallProgress(handler) {
    const listener = (_event: IpcRendererEvent, status: unknown) =>
      handler(normalizeInstallStatus(status))
    ipcRenderer.on(HOME_CHANNELS.updateInstallProgress, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.updateInstallProgress, listener)
  },
  async getPerfCheck() {
    const r = (await ipcRenderer.invoke(HOME_CHANNELS.getPerfCheck)) as PerfReport | null
    return r && typeof r === 'object' ? r : null
  },
  async runPerfCheck() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.runPerfCheck)) as PerfReport
  },
  onPerfCheckProgress(handler) {
    const listener = (_event: IpcRendererEvent, p: Partial<PerfProgress> | null) => {
      if (p && PERF_STEPS.includes(p.step as PerfProgress['step'])) handler(p as PerfProgress)
    }
    ipcRenderer.on(HOME_CHANNELS.perfCheckProgress, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.perfCheckProgress, listener)
  },
  async copyPerfReport() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.copyPerfReport)) === true
  },
}

contextBridge.exposeInMainWorld('hyperFiles', homeApi)

const tabsApi: TabsApi = {
  async list() {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.list)
    return Array.isArray(result) ? (result as TabSummary[]) : []
  },
  async activate(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.activate, id)
  },
  async close(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.close, id)
  },
  async showMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showMenu, x, y)
  },
  async showNewMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showNewMenu, x, y)
  },
  async showTabMenu(id, x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showTabMenu, id, x, y)
  },
  async detach(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.detach, id)
  },
  async tearOff(id, screenX, screenY) {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.tearOff, id, screenX, screenY)
    return result === true
  },
  dragTornWindow(screenX, screenY) {
    ipcRenderer.send(TABS_CHANNELS.dragTornWindow, screenX, screenY)
  },
  async dockTornWindow(index) {
    await ipcRenderer.invoke(TABS_CHANNELS.dockTornWindow, index)
  },
  async endTornDrag() {
    await ipcRenderer.invoke(TABS_CHANNELS.endTornDrag)
  },
  onDockPreview(handler) {
    const listener = (_event: IpcRendererEvent, preview: { x: number } | null) =>
      handler(preview && typeof preview.x === 'number' ? { x: preview.x } : null)
    ipcRenderer.on(TABS_CHANNELS.dockPreview, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.dockPreview, listener)
  },
  reportDockIndex(index) {
    ipcRenderer.send(TABS_CHANNELS.dockIndex, index)
  },
  async showAppMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showAppMenu, x, y)
  },
  async reorder(id, toIndex) {
    await ipcRenderer.invoke(TABS_CHANNELS.reorder, id, toIndex)
  },
  onChanged(handler) {
    const listener = (_event: IpcRendererEvent, tabs: TabSummary[]) => handler(tabs)
    ipcRenderer.on(TABS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.changed, listener)
  },
  notifyChromePressed() {
    ipcRenderer.send(TABS_CHANNELS.chromePressed)
  },
  onChromePressed(handler) {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
}

contextBridge.exposeInMainWorld('hyperFilesTabs', tabsApi)

const pdfToolsApi: PdfToolsApi = {
  pickFiles: (kind, multiple) => ipcRenderer.invoke(PDF_TOOLS_CHANNELS.pickFiles, kind, multiple),
  pickFolder: () => ipcRenderer.invoke(PDF_TOOLS_CHANNELS.pickFolder),
  info: (path, password) => ipcRenderer.invoke(PDF_TOOLS_CHANNELS.info, path, password),
  run: (request) => ipcRenderer.invoke(PDF_TOOLS_CHANNELS.run, request),
  onProgress(handler) {
    const listener = (_event: IpcRendererEvent, progress: ToolProgress) => handler(progress)
    ipcRenderer.on(PDF_TOOLS_CHANNELS.progress, listener)
    return () => ipcRenderer.removeListener(PDF_TOOLS_CHANNELS.progress, listener)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('hyperPdfTools', pdfToolsApi)

// open documents dragged from the OS anywhere over Home or the tab strip
installDropOpenBridge()
