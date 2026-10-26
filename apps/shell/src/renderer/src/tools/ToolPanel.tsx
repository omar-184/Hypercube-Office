import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  COMBINING_TOOLS,
  IMAGE_EXTENSIONS,
  type ToolError,
  type ToolFile,
  type ToolId,
  type ToolOptions,
  type ToolProgress,
  type ToolRequest,
  type ToolResult,
} from '../../../shared/pdf-tools-api'
import type { ToolStringKey } from '../i18n/strings-tools'
import { defaultOptions, toolDef } from './catalog'
import { ToolIcon } from './ToolIcon'
import { ToolOptionsForm } from './ToolOptionsForm'
import { baseName, formatBytes, useToolsI18n, type ToolsT } from './use-tools-i18n'

interface Entry {
  path: string
  status: 'checking' | 'ready' | 'locked' | 'error'
  pages?: number
  size?: number
  /** the password that unlocked it */
  password?: string
  /** what the user is typing into the unlock box */
  draft: string
  wrongPassword?: boolean
  error?: ToolError
  /** merge: pages of this file to take */
  pageExpr: string
  metadata?: ToolOptions['properties']
}

const IMAGE_RE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i')
const PDF_RE = /\.pdf$/i

const ERROR_KEYS: Record<ToolError['code'], ToolStringKey> = {
  'password-required': 'errPasswordRequired',
  'wrong-password': 'errWrongPassword',
  'not-pdf': 'errNotPdf',
  damaged: 'errDamaged',
  'bad-input': 'errBadInput',
  'bad-pages': 'errBadPages',
  unsupported: 'errUnsupported',
  io: 'errIo',
  failed: 'errFailed',
}

export function errorText(t: ToolsT, err: ToolError): string {
  return t(ERROR_KEYS[err.code] ?? 'errFailed', { detail: err.message })
}

/** Where one input stands while a run is going, for runs that take the inputs one by one */
type RunState = 'waiting' | 'working' | 'finished'

const RUN_STATE_KEYS: Record<RunState, ToolStringKey> = {
  waiting: 'fileWaiting',
  working: 'working',
  finished: 'fileFinished',
}

function progressLabel(t: ToolsT, p: ToolProgress | null): string {
  const parts: string[] = []
  if (p && p.total > 1) {
    parts.push(t('progressFile', { n: Math.min(p.done + 1, p.total), total: p.total }))
  }
  if (p?.pagesTotal) {
    const page = Math.min((p.pagesDone ?? 0) + 1, p.pagesTotal)
    parts.push(t('progressPage', { n: page, total: p.pagesTotal }))
  }
  return parts.length > 0 ? parts.join(' · ') : t('working')
}

/** 0..1, or null when there is nothing to count (one file in one step) */
function progressFraction(p: ToolProgress | null): number | null {
  if (!p || (p.total <= 1 && !p.pagesTotal)) return null
  const page = p.pagesTotal ? (p.pagesDone ?? 0) / p.pagesTotal : 0
  return Math.min(1, (p.done + page) / p.total)
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const mmss = `${Math.floor(s / 60) % 60}:${String(s % 60).padStart(2, '0')}`
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mmss.padStart(5, '0')}` : mmss
}

/** Validation that stops Start, as a message; null when the request can run. */
function blocker(
  tool: ToolId,
  entries: readonly Entry[],
  options: ToolOptions[ToolId],
  repeat: string,
): ToolStringKey | null {
  const def = toolDef(tool)
  if (entries.length === 0) return 'needFiles'
  if (entries.length < def.minFiles) return 'needTwo'
  if (entries.some((e) => e.status === 'locked' || e.status === 'checking')) return 'needUnlock'
  if (tool === 'protect') {
    const o = options as ToolOptions['protect']
    if (!o.userPassword && !o.ownerPassword) return 'protectEmpty'
    if (o.userPassword !== repeat) return 'protectMismatch'
    if (o.userPassword.includes(',') || o.ownerPassword.includes(',')) return 'protectComma'
  }
  return null
}

export function ToolPanel({
  tool,
  initialPaths,
  onBack,
  onBusyChange,
}: {
  tool: ToolId
  initialPaths: string[]
  onBack: () => void
  /** must be stable: it is left out of effect dependencies */
  onBusyChange?: (busy: boolean) => void
}) {
  const { t } = useToolsI18n()
  const def = toolDef(tool)
  const api = window.hyperPdfTools
  const [entries, setEntries] = useState<Entry[]>([])
  const [options, setOptions] = useState<ToolOptions[ToolId]>(() => {
    const all = defaultOptions()
    // the default watermark is a word in the UI language, so it is filled in here
    return tool === 'watermark' ? { ...all.watermark, text: t('watermarkDefault') } : all[tool]
  })
  const [repeat, setRepeat] = useState('')
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [phase, setPhase] = useState<'edit' | 'running' | 'done'>('edit')
  const [progress, setProgress] = useState<ToolProgress | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [result, setResult] = useState<ToolResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const cancelRef = useRef<HTMLButtonElement>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  /** where focus goes when the results give way to the form again */
  const focusOnEdit = useRef<'start' | 'add' | null>(null)

  const update = (path: string, patch: Partial<Entry>) =>
    setEntries((list) => list.map((e) => (e.path === path ? { ...e, ...patch } : e)))

  async function inspect(path: string, password?: string) {
    // update() is a functional state update queued behind the add, so a reply
    // that beats the first render still lands; a removed file is skipped
    const info = await api.info(path, password)
    if (info.ok) {
      update(path, {
        status: 'ready',
        size: info.size,
        pages: info.kind === 'pdf' ? info.pages : undefined,
        metadata: info.kind === 'pdf' ? info.metadata : undefined,
        password,
        wrongPassword: false,
      })
    } else if (info.error.code === 'password-required') {
      update(path, { status: 'locked' })
    } else if (info.error.code === 'wrong-password') {
      update(path, { status: 'locked', wrongPassword: true })
    } else {
      update(path, { status: 'error', error: info.error })
    }
  }

  function addPaths(paths: readonly string[]) {
    const wanted = def.input === 'image' ? IMAGE_RE : PDF_RE
    const known = new Set(entriesRef.current.map((e) => e.path))
    const fresh = [...new Set(paths)].filter((p) => wanted.test(p) && !known.has(p))
    if (fresh.length === 0) return
    setEntries((list) => [
      ...list,
      ...fresh
        .filter((path) => !list.some((e) => e.path === path))
        .map((path) => ({ path, status: 'checking' as const, draft: '', pageExpr: '' })),
    ])
    // one at a time keeps a big drop from loading every file at once
    void (async () => {
      for (const p of fresh) await inspect(p)
    })()
  }

  // files handed over from the tool grid's drop zone; runs once on open
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (initialPaths.length > 0) addPaths(initialPaths)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => api.onProgress(setProgress), [api])

  const busy = phase === 'running'
  useEffect(() => {
    onBusyChange?.(busy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])

  // the Start button goes away while running: Cancel takes the focus
  useEffect(() => {
    if (phase === 'running') cancelRef.current?.focus()
    if (phase === 'edit' && focusOnEdit.current) {
      ;(focusOnEdit.current === 'start' ? startRef : addRef).current?.focus()
      focusOnEdit.current = null
    }
  }, [phase])

  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy])

  // properties: one file pre-fills the form with what it already says
  const firstMeta = entries.length === 1 ? entries[0].metadata : undefined
  useEffect(() => {
    if (tool === 'properties' && firstMeta) setOptions({ ...firstMeta })
  }, [tool, firstMeta])

  async function pick() {
    const paths = await api.pickFiles(def.input, true)
    addPaths(paths)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => {
        try {
          return api.pathForFile(f)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    addPaths(paths)
  }

  // keep file drags here: Home's drop-to-open overlay and bridge must not see
  // them. While a run is going the list is fixed, so a drop is refused.
  const dragProps = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (busy) e.dataTransfer.dropEffect = 'none'
      else setDragging(true)
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (busy) e.dataTransfer.dropEffect = 'none'
    },
    onDragLeave: (e: DragEvent) => {
      e.stopPropagation()
      if (e.currentTarget === e.target) setDragging(false)
    },
    onDrop: (e: DragEvent) => {
      if (!busy) return onDrop(e)
      e.preventDefault()
      e.stopPropagation()
    },
  }

  function move(index: number, by: number) {
    setEntries((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item)
      return next
    })
  }

  async function start() {
    const files: ToolFile[] = entries.map((e) => ({
      path: e.path,
      ...(e.password ? { password: e.password } : {}),
      ...(tool === 'merge' && e.pageExpr.trim() ? { pages: e.pageExpr } : {}),
    }))
    const request = {
      tool,
      files,
      options,
      ...(outputDir ? { outputDir } : {}),
    } as ToolRequest
    // inputs taken one by one are counted from the start; a merge is one step
    setProgress(COMBINING_TOOLS.has(tool) ? null : { done: 0, total: files.length })
    setCanceling(false)
    setStartedAt(Date.now())
    setPhase('running')
    try {
      setResult(await api.run(request))
    } catch (err) {
      setResult({ ok: false, error: { code: 'failed', message: String(err) } })
    }
    setCanceling(false)
    setPhase('done')
  }

  function cancel() {
    setCanceling(true)
    void api.cancel()
  }

  const block = blocker(tool, entries, options, repeat)
  const multiple = def.input === 'image' || tool === 'merge'
  const fraction = busy ? progressFraction(progress) : null
  const runState = (i: number): RunState | undefined => {
    if (!busy || !progress || progress.total <= 1) return undefined
    return i < progress.done ? 'finished' : i === progress.done ? 'working' : 'waiting'
  }

  return (
    <div className="pt-panel">
      <button className="pt-back" onClick={onBack} disabled={busy}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        {t('back')}
      </button>
      <header className="pt-panel-head">
        <span className="pt-panel-icon">
          <ToolIcon id={tool} size={32} />
        </span>
        <div>
          <h1 className="pt-panel-title">{t(def.name)}</h1>
          <p className="pt-panel-desc">{t(def.desc)}</p>
        </div>
      </header>

      {phase === 'done' && result ? (
        <Results
          result={result}
          total={entries.length}
          t={t}
          onAgain={() => {
            focusOnEdit.current = 'start'
            setPhase('edit')
            setResult(null)
          }}
          onReset={() => {
            focusOnEdit.current = 'add'
            setEntries([])
            setPhase('edit')
            setResult(null)
          }}
        />
      ) : (
        <>
          <section
            className={`pt-drop${dragging ? ' dragging' : ''}${entries.length ? ' has-files' : ''}`}
            {...dragProps}
          >
            {entries.length === 0 ? (
              <div className="pt-drop-empty">
                <span>{t(def.input === 'image' ? 'dropImages' : 'dropPdfs')}</span>
                <span className="pt-drop-or">{t('dropOr')}</span>
                <button ref={addRef} className="btn btn-primary" onClick={() => void pick()}>
                  {t(def.input === 'image' ? 'addImages' : 'addPdfs')}
                </button>
              </div>
            ) : (
              <>
                <ul className="pt-files">
                  {entries.map((e, i) => (
                    <FileRow
                      key={e.path}
                      entry={e}
                      index={i}
                      count={entries.length}
                      tool={tool}
                      reorderable={multiple}
                      disabled={busy}
                      runState={runState(i)}
                      t={t}
                      onMove={move}
                      onRemove={() => setEntries((list) => list.filter((x) => x.path !== e.path))}
                      onDraft={(draft) => update(e.path, { draft, wrongPassword: false })}
                      onUnlock={() => {
                        update(e.path, { status: 'checking' })
                        void inspect(e.path, e.draft)
                      }}
                      onPages={(pageExpr) => update(e.path, { pageExpr })}
                    />
                  ))}
                </ul>
                <div className="pt-files-actions">
                  <button className="pt-link" onClick={() => void pick()} disabled={busy}>
                    + {t('addMore')}
                  </button>
                  <button className="pt-link" onClick={() => setEntries([])} disabled={busy}>
                    {t('clearAll')}
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="pt-options">
            <ToolOptionsForm
              tool={tool}
              options={options}
              onChange={setOptions}
              repeat={repeat}
              onRepeat={setRepeat}
              disabled={busy}
              t={t}
            />
            <div className="pt-field">
              <span className="pt-field-label">{t('saveTo')}</span>
              <div className="pt-save-to">
                <span className="pt-save-path" title={outputDir ?? undefined}>
                  {outputDir ?? t('saveBeside')}
                </span>
                <button
                  className="pt-link"
                  disabled={busy}
                  onClick={() => void api.pickFolder().then((d) => d && setOutputDir(d))}
                >
                  {t('saveChoose')}
                </button>
                {outputDir && (
                  <button className="pt-link" disabled={busy} onClick={() => setOutputDir(null)}>
                    {t('saveReset')}
                  </button>
                )}
              </div>
            </div>
          </section>

          {busy ? (
            <div className="pt-progress">
              <div className="pt-progress-head">
                <span className="pt-progress-label" id="pt-progress-label">
                  {canceling ? t('canceling') : progressLabel(t, progress)}
                </span>
                <span className="pt-progress-time">
                  {t('elapsed', { time: formatElapsed(Math.max(0, now - startedAt)) })}
                </span>
                {/* aria-disabled, not disabled: a disabled button would drop the focus */}
                <button
                  ref={cancelRef}
                  className="btn btn-secondary pt-small-btn"
                  aria-disabled={canceling}
                  onClick={canceling ? undefined : cancel}
                >
                  {t('cancel')}
                </button>
              </div>
              <div
                className={`pt-bar${fraction === null ? ' indeterminate' : ''}`}
                role="progressbar"
                aria-labelledby="pt-progress-label"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
              >
                <div
                  className="pt-bar-fill"
                  style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="pt-run">
              <button
                ref={startRef}
                className="btn btn-primary pt-start"
                disabled={block !== null}
                onClick={() => void start()}
              >
                {t('start')}
              </button>
              {block && entries.length > 0 && <span className="pt-block">{t(block)}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FileRow({
  entry: e,
  index,
  count,
  tool,
  reorderable,
  disabled,
  runState,
  t,
  onMove,
  onRemove,
  onDraft,
  onUnlock,
  onPages,
}: {
  entry: Entry
  index: number
  count: number
  tool: ToolId
  reorderable: boolean
  disabled: boolean
  runState?: RunState
  t: ToolsT
  onMove: (index: number, by: number) => void
  onRemove: () => void
  onDraft: (v: string) => void
  onUnlock: () => void
  onPages: (v: string) => void
}) {
  return (
    <li className={`pt-file ${e.status}${runState ? ` run-${runState}` : ''}`}>
      <div className="pt-file-main">
        {reorderable && <span className="pt-file-index">{index + 1}</span>}
        <span className="pt-file-name" title={e.path}>
          {baseName(e.path)}
        </span>
        <span className="pt-file-meta">
          {runState && t(RUN_STATE_KEYS[runState])}
          {!runState && e.status === 'checking' && t('checking')}
          {e.status === 'locked' && t('locked')}
          {!runState &&
            e.status === 'ready' &&
            [
              e.pages !== undefined
                ? e.pages === 1
                  ? t('pagesOne')
                  : t('pagesMany', { n: e.pages })
                : null,
              e.size !== undefined ? formatBytes(e.size) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
        </span>
        {tool === 'merge' && e.status === 'ready' && (
          <input
            className="pt-input pt-file-pages"
            value={e.pageExpr}
            disabled={disabled}
            spellCheck={false}
            placeholder={t('pagesFromFileHint')}
            aria-label={t('pagesFromFile')}
            title={t('pagesHint')}
            onChange={(ev) => onPages(ev.target.value)}
          />
        )}
        {reorderable && (
          <>
            <button
              className="pt-icon-btn"
              title={t('moveUp')}
              aria-label={t('moveUp')}
              disabled={disabled || index === 0}
              onClick={() => onMove(index, -1)}
            >
              ↑
            </button>
            <button
              className="pt-icon-btn"
              title={t('moveDown')}
              aria-label={t('moveDown')}
              disabled={disabled || index === count - 1}
              onClick={() => onMove(index, 1)}
            >
              ↓
            </button>
          </>
        )}
        <button
          className="pt-icon-btn"
          title={t('remove')}
          aria-label={t('remove')}
          disabled={disabled}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {e.status === 'locked' && (
        <form
          className="pt-file-unlock"
          onSubmit={(ev) => {
            ev.preventDefault()
            if (e.draft) onUnlock()
          }}
        >
          <span>{e.wrongPassword ? t('passwordWrong') : t('passwordNeeded')}</span>
          <input
            className="pt-input"
            type="password"
            value={e.draft}
            placeholder={t('passwordPlaceholder')}
            autoComplete="off"
            onChange={(ev) => onDraft(ev.target.value)}
          />
          <button className="btn btn-secondary" type="submit" disabled={!e.draft}>
            {t('passwordApply')}
          </button>
        </form>
      )}
      {e.status === 'error' && e.error && (
        <div className="pt-file-error">{errorText(t, e.error)}</div>
      )}
    </li>
  )
}

function Results({
  result,
  total,
  t,
  onAgain,
  onReset,
}: {
  result: ToolResult
  /** inputs in the request */
  total: number
  t: ToolsT
  onAgain: () => void
  onReset: () => void
}) {
  const home = window.hyperFiles
  const items = result.ok ? result.items : []
  const canceled = result.ok && result.canceled === true
  const failed = !canceled && (!result.ok || items.every((i) => i.error))
  const partial = !failed && items.some((i) => i.error)
  // one file out: opening it is what comes next
  const single = items.length === 1 && items[0].outputs.length === 1
  const titleRef = useRef<HTMLHeadingElement>(null)
  // the form that had focus is gone; the outcome takes it, and a screen reader reads it
  useEffect(() => titleRef.current?.focus(), [])
  return (
    <section className="pt-results">
      <h2
        ref={titleRef}
        tabIndex={-1}
        className={`pt-results-title${failed ? ' failed' : canceled ? ' canceled' : ''}`}
      >
        {canceled
          ? t('canceledTitle')
          : failed
            ? t('doneFailed')
            : partial
              ? t('doneSome')
              : t('doneTitle')}
      </h2>
      {canceled && (
        <p className="pt-results-note">
          {items.length > 0 ? t('canceledSome', { done: items.length, total }) : t('canceledNone')}
        </p>
      )}
      {!result.ok && <p className="pt-file-error">{errorText(t, result.error)}</p>}
      <ul className="pt-files">
        {items.map((item) => (
          <li key={item.source} className={`pt-file${item.error ? ' error' : ''}`}>
            <div className="pt-file-main">
              <span className="pt-file-name" title={item.source}>
                {item.outputs.length === 1
                  ? baseName(item.outputs[0].path)
                  : item.outputs.length > 1
                    ? `${baseName(item.source)} → ${t('outputsMany', { n: item.outputs.length })}`
                    : baseName(item.source)}
              </span>
              <span className="pt-file-meta">
                {item.originalSize !== undefined && item.outputs[0]
                  ? compressLine(t, item.originalSize, item.outputs[0].size)
                  : item.outputs.length === 1
                    ? formatBytes(item.outputs[0].size)
                    : ''}
              </span>
              {item.outputs.length === 1 && PDF_RE.test(item.outputs[0].path) && (
                <button
                  className={`btn ${single ? 'btn-primary' : 'btn-secondary'} pt-small-btn`}
                  onClick={() => void home.openPath(item.outputs[0].path)}
                >
                  {t('open')}
                </button>
              )}
              {item.outputs.length > 0 && (
                <button
                  className="btn btn-secondary pt-small-btn"
                  onClick={() => void home.revealPath(item.outputs[0].path)}
                >
                  {t('showInFolder')}
                </button>
              )}
            </div>
            {item.error && <div className="pt-file-error">{errorText(t, item.error)}</div>}
          </li>
        ))}
      </ul>
      <div className="pt-run">
        <button className="btn btn-secondary" onClick={onAgain}>
          {t('runAgain')}
        </button>
        <button className="btn btn-secondary" onClick={onReset}>
          {t('startOver')}
        </button>
      </div>
    </section>
  )
}

function compressLine(t: ToolsT, from: number, to: number): string {
  if (to >= from) return t('compressNoGain')
  return t('compressSaved', {
    from: formatBytes(from),
    to: formatBytes(to),
    pct: Math.round((1 - to / from) * 100),
  })
}
