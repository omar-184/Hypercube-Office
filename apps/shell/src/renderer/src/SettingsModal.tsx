import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Dropdown, useModalKeys } from '@genoffice/ui'
import type {
  DefaultAppStatus,
  DocTheme,
  UiTheme,
  UpdateCheckResult,
  UpdateInstallStatus,
} from '../../shared/home-api'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import { PerformancePane } from './PerformancePane'
import './settings.css'

// ── Settings modal (opened from the sidebar Settings entry) ─────────
// Two-pane dialog: section nav on the left, fields on the right.
// All values go through the existing home IPC; nothing is stored locally.

// sorted by ISO 639 language code — native-script labels have no natural
// shared alphabet, so the code is the ordering key
const LANG_OPTIONS = [
  { value: 'ar', label: 'العربية' },
  { value: 'cs', label: 'Čeština' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'he', label: 'עברית' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'th', label: 'ไทย' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const

// GenMail's option order: follow-system first, then the manual picks
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]

// Document page theme (#1811): the canvas/paper preference the editors follow;
// 'follow' keeps the pre-existing behavior of riding the UI theme
const DOC_THEME_OPTIONS = [
  { value: 'follow', labelKey: 'docThemeFollowApp' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: DocTheme; labelKey: StringKey }[]

type SectionId = 'general' | 'performance' | 'about'

/** the attribution line from NOTICE; a legal notice, so it is not translated */
const COPYRIGHT_LINE = 'Copyright © 2026 The Hypercube Office contributors'

const SECTIONS: readonly { id: SectionId; labelKey: StringKey }[] = [
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'performance', labelKey: 'setSecPerformance' },
  { id: 'about', labelKey: 'setSecAbout' },
]

function SectionIcon({ id }: { id: SectionId }) {
  if (id === 'general') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5h8M13 5h1M2 11h1M6 11h8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  if (id === 'performance') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2.3 11.5a6 6 0 1 1 11.4 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path d="M8 10l2.6-3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="10" r="1" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.4v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}

/** label-over-value field row with an optional right-aligned action */
function Field({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

export interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<SectionId>('general')
  const [theme, setTheme] = useState<UiTheme>('system')
  const [docTheme, setDocTheme] = useState<DocTheme>('follow')
  const [saveDir, setSaveDir] = useState('')
  const [autoSaveOn, setAutoSaveOn] = useState(false)
  const [defaultApp, setDefaultApp] = useState<DefaultAppStatus | null>(null)
  const [defaultAppBusy, setDefaultAppBusy] = useState(false)
  const [defaultAppFailed, setDefaultAppFailed] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [updatesOn, setUpdatesOn] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [install, setInstall] = useState<UpdateInstallStatus | null>(null)

  useEffect(() => {
    let alive = true
    void window.hyperFiles.getTheme?.().then((th) => {
      if (alive) setTheme(th)
    })
    void window.hyperFiles.getDocumentTheme?.().then((th) => {
      if (alive) setDocTheme(th)
    })
    void window.hyperFiles.getDefaultSaveDir?.().then((dir) => {
      if (alive && dir) setSaveDir(dir)
    })
    void window.hyperFiles.getAutoSaveDefault?.().then((v) => {
      if (alive) setAutoSaveOn(v.on)
    })
    void window.hyperFiles.getDefaultAppStatus?.().then((st) => {
      if (alive) setDefaultApp(st)
    })
    void window.hyperFiles.getAppVersion?.().then((v) => {
      if (alive && v) setAppVersion(v)
    })
    void window.hyperFiles.getUpdateCheck?.().then((st) => {
      if (!alive) return
      setUpdatesOn(st.enabled)
      setUpdateResult(st.last)
      if (st.last?.state === 'available') {
        void window.hyperFiles.getUpdateInstall?.().then((s) => {
          if (alive) setInstall(s)
        })
      }
    })
    const offProgress = window.hyperFiles.onUpdateInstallProgress?.(setInstall)
    return () => {
      alive = false
      offProgress?.()
    }
  }, [])

  // Esc closes, Tab stays inside, and focus goes back to Settings on close
  const modalKeys = useModalKeys(onClose, { restoreFocus: true })

  const applyTheme = (next: UiTheme) => {
    setTheme(next)
    void window.hyperFiles.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }

  const applyDocumentTheme = (next: DocTheme) => {
    setDocTheme(next)
    void window.hyperFiles.setDocumentTheme(next)
  }

  const changeSaveDir = () => {
    void window.hyperFiles.pickDefaultSaveDir?.().then((dir) => {
      if (dir) setSaveDir(dir)
    })
  }

  // Windows only opens the system page; re-read ownership when the user comes back
  useEffect(() => {
    if (!defaultApp?.manualOnly) return
    const refresh = () => {
      void window.hyperFiles.getDefaultAppStatus?.().then(setDefaultApp)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [defaultApp?.manualOnly])

  const claimDefaultApp = () => {
    setDefaultAppBusy(true)
    setDefaultAppFailed(false)
    void window.hyperFiles
      .setDefaultApp()
      .then((st) => {
        setDefaultApp(st)
        if (!st.manualOnly && st.state !== 'default') setDefaultAppFailed(true)
      })
      .catch(() => setDefaultAppFailed(true))
      .finally(() => setDefaultAppBusy(false))
  }

  const checkUpdates = () => {
    setUpdateBusy(true)
    void window.hyperFiles
      .checkForUpdates()
      .then(async (result) => {
        setUpdateResult(result)
        setInstall(
          result.state === 'available'
            ? ((await window.hyperFiles.getUpdateInstall?.()) ?? null)
            : null,
        )
      })
      .catch(() => setUpdateResult({ state: 'failed', checkedAt: Date.now() }))
      .finally(() => setUpdateBusy(false))
  }

  const toggleUpdates = () => {
    const next = !updatesOn
    void window.hyperFiles
      .setUpdateCheck(next)
      .then(() => setUpdatesOn(next))
      .catch(() => {})
  }

  const downloadUpdate = () => {
    void window.hyperFiles
      .downloadUpdate()
      .then(setInstall)
      .catch(() => setInstall((s) => (s ? { ...s, state: 'failed' } : s)))
  }

  const canInstall =
    updateResult?.state === 'available' && !!install && install.state !== 'unsupported'

  const updateDesc = (() => {
    if (updateBusy) return t('setUpdatesChecking')
    const version = install?.version ?? updateResult?.version ?? ''
    if (canInstall && install.state === 'downloading') {
      const percent = install.total > 0 ? Math.floor((install.received / install.total) * 100) : 0
      return t('setUpdatesDownloading', { version, percent: String(percent) })
    }
    if (canInstall && install.state === 'ready') return t('setUpdatesReady', { version })
    if (canInstall && install.state === 'failed') return t('setUpdatesInstallFailed')
    if (!updateResult) return t('setUpdatesDesc')
    if (updateResult.state === 'available') return t('setUpdatesAvailable', { version })
    if (updateResult.state === 'latest') return t('setUpdatesLatest')
    return t('setUpdatesFailed')
  })()

  const updateAction = (() => {
    if (updateResult?.state !== 'available') {
      return (
        <button className="set-btn" disabled={updateBusy} onClick={checkUpdates}>
          {t('setUpdatesCheckNow')}
        </button>
      )
    }
    if (!canInstall) {
      return (
        <button className="set-btn" onClick={() => void window.hyperFiles.openUpdatePage?.()}>
          {t('setUpdatesDownload')}
        </button>
      )
    }
    if (install.state === 'ready') {
      return (
        <button className="set-btn" onClick={() => void window.hyperFiles.installUpdate()}>
          {t('setUpdatesRestart')}
        </button>
      )
    }
    return (
      <button
        className="set-btn"
        disabled={install.state === 'downloading'}
        onClick={downloadUpdate}
      >
        {t('setUpdatesInstall')}
      </button>
    )
  })()

  const defaultAppDesc = (() => {
    if (!defaultApp) return ''
    if (defaultAppFailed) return t('setDefaultAppFailed')
    if (defaultApp.state === 'default') return t('setDefaultAppIs')
    if (defaultApp.state === 'other' && defaultApp.others.length > 0)
      return t('setDefaultAppOther', { app: defaultApp.others.join(', ') })
    return t('setDefaultAppDesc')
  })()

  return (
    <div
      className="set-overlay"
      ref={modalKeys.ref}
      onKeyDown={modalKeys.onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="set-dialog" role="dialog" aria-modal="true" aria-labelledby="set-title">
        <div className="set-header">
          <h2 className="set-title" id="set-title">
            {t('settings')}
          </h2>
          <button
            className="set-close"
            onClick={onClose}
            aria-label={t('close')}
            title={t('close')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('settings')}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`set-nav-item${section === s.id ? ' active' : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => setSection(s.id)}
              >
                <SectionIcon id={s.id} />
                {t(s.labelKey)}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {section === 'general' && (
              <>
                <h3 className="set-pane-title">{t('setSecGeneral')}</h3>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-label">{t('language')}</div>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={lang}
                    ariaLabel={t('language')}
                    options={LANG_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    onPick={(v) => setLang(v as typeof lang)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-label">{t('theme')}</div>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={theme}
                    ariaLabel={t('theme')}
                    options={THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyTheme(v as UiTheme)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-label">{t('documentTheme')}</div>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={docTheme}
                    ariaLabel={t('documentTheme')}
                    options={DOC_THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyDocumentTheme(v as DocTheme)}
                  />
                </div>
                {defaultApp && defaultApp.state !== 'unsupported' && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <div className="set-field-stack">
                        <div className="set-field-label">{t('setDefaultApp')}</div>
                        <div className="set-field-desc">{defaultAppDesc}</div>
                      </div>
                    </div>
                    <button
                      className="set-btn"
                      disabled={defaultAppBusy || defaultApp.state === 'default'}
                      onClick={claimDefaultApp}
                    >
                      {defaultApp.manualOnly
                        ? t('setDefaultAppOpenSettings')
                        : t('setDefaultAppSet')}
                    </button>
                  </div>
                )}
                <Field
                  label={t('saveLocation')}
                  value={saveDir || '—'}
                  valueTitle={saveDir}
                  action={
                    <button className="set-btn" onClick={changeSaveDir}>
                      {t('setChange')}
                    </button>
                  }
                />
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAutoSave')}</div>
                      <div className="set-field-desc">{t('setAutoSaveDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={autoSaveOn}
                    aria-label={t('setAutoSave')}
                    onClick={() => {
                      const next = !autoSaveOn
                      setAutoSaveOn(next)
                      void window.hyperFiles.setAutoSaveDefault?.(next).catch(() => {})
                    }}
                  />
                </div>
              </>
            )}
            {section === 'performance' && <PerformancePane />}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setUpdates')}</div>
                      <div className="set-field-desc">{updateDesc}</div>
                    </div>
                  </div>
                  {updateAction}
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={updatesOn}
                    aria-label={t('setUpdatesAuto')}
                    title={t('setUpdatesAuto')}
                    onClick={toggleUpdates}
                  />
                </div>
                {/* AGPL-3.0 §5(d): an interactive UI shows the license, the absence of
                    warranty and where to read the terms */}
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setLicense')}</div>
                      <div className="set-field-desc">
                        {COPYRIGHT_LINE}
                        <br />
                        {t('setLicenseDesc')}
                      </div>
                    </div>
                  </div>
                  <button
                    className="set-btn"
                    onClick={() => void window.hyperFiles.openLegalNotice('license')}
                  >
                    {t('setViewLicense')}
                  </button>
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setNotices')}</div>
                      <div className="set-field-desc">{t('setNoticesDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-btn"
                    onClick={() => void window.hyperFiles.openLegalNotice('notices')}
                  >
                    {t('setViewNotices')}
                  </button>
                </div>
                <Field
                  label={t('setGithub')}
                  value="github.com/omar-184/Hypercube-Office"
                  action={
                    <button
                      className="set-btn"
                      onClick={() => void window.hyperFiles.openGitHubRepo?.()}
                    >
                      {t('openOnGitHub')}
                    </button>
                  }
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
