import { useState } from 'react'
import type { PdfToolsApi, ToolId } from '../../../shared/pdf-tools-api'
import { GROUPS, TOOLS } from './catalog'
import { ToolIcon } from './ToolIcon'
import { ToolPanel } from './ToolPanel'
import { useToolsI18n } from './use-tools-i18n'
import './tools.css'

declare global {
  interface Window {
    hyperPdfTools: PdfToolsApi
  }
}

/** Home's PDF tools area: a grid of tools, then one tool's panel. */
export function PdfToolsView() {
  const { t } = useToolsI18n()
  const [active, setActive] = useState<ToolId | null>(null)

  if (active) {
    return (
      <main className="content">
        <div className="pt-content">
          <ToolPanel key={active} tool={active} initialPaths={[]} onBack={() => setActive(null)} />
        </div>
      </main>
    )
  }

  return (
    <main className="content">
      <div className="pt-content">
        <header className="pt-head">
          <h1 className="hero-title">{t('title')}</h1>
          <p className="pt-subtitle">{t('subtitle')}</p>
        </header>
        {GROUPS.map((g) => (
          <section key={g.id} className="pt-group" aria-label={t(g.label)}>
            <div className="section-head">
              <span className="section-label">{t(g.label)}</span>
            </div>
            <div className="pt-grid">
              {TOOLS.filter((tool) => tool.group === g.id).map((tool) => (
                <button key={tool.id} className="pt-card" onClick={() => setActive(tool.id)}>
                  <span className="pt-card-icon">
                    <ToolIcon id={tool.id} />
                  </span>
                  <span className="pt-card-text">
                    <span className="pt-card-name">{t(tool.name)}</span>
                    <span className="pt-card-desc">{t(tool.desc)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
