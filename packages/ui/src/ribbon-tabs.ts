/**
 * WAI-ARIA tabs for a ribbon's tab row. The row is a tablist, the selected
 * tab is the row's only Tab stop, and Left/Right/Home/End select a tab the way
 * Office does, by clicking it, so each app's own click handler stays the only
 * path that switches tabs. The band under the row is the tabpanel.
 */
import type { Lang } from '@genoffice/i18n'
import type { KeyboardEvent } from 'react'

export const RIBBON_PANEL_ID = 'ribbon-panel'

/** ids are IDREFs, so a tab named with spaces ("Page Layout") becomes "Page-Layout" */
export const ribbonTabId = (name: string): string => `ribbon-tab-${name.replace(/[^\w-]/g, '-')}`

/** Accessible name of the tab row, in the editor's language. */
export const RIBBON_TABS_LABELS: Record<Lang, string> = {
  zh: '功能区选项卡',
  en: 'Ribbon tabs',
  ja: 'リボンのタブ',
  ko: '리본 탭',
  fr: 'Onglets du ruban',
  de: 'Menübandregisterkarten',
  es: 'Pestañas de la cinta de opciones',
  th: 'แท็บริบบอน',
  id: 'Tab pita',
  ru: 'Вкладки ленты',
  ar: 'علامات تبويب الشريط',
  pt: 'Guias da faixa de opções',
  it: 'Schede della barra multifunzione',
  pl: 'Karty wstążki',
  cs: 'Karty pásu karet',
  nl: 'Linttabbladen',
  ms: 'Tab reben',
  he: 'כרטיסיות רצועת הכלים',
  hi: 'रिबन टैब',
  'zh-TW': '功能區索引標籤',
  vi: 'Tab dải băng',
}

export function ribbonTabListProps(lang: Lang) {
  return {
    role: 'tablist' as const,
    'aria-label': RIBBON_TABS_LABELS[lang],
    onKeyDown: moveBetweenRibbonTabs,
  }
}

export function ribbonTabProps(name: string, selected: boolean) {
  return {
    role: 'tab' as const,
    id: ribbonTabId(name),
    'aria-selected': selected,
    'aria-controls': RIBBON_PANEL_ID,
    tabIndex: selected ? 0 : -1,
  }
}

export function ribbonPanelProps(selected: string) {
  return {
    role: 'tabpanel' as const,
    id: RIBBON_PANEL_ID,
    'aria-labelledby': ribbonTabId(selected),
  }
}

/** Arrow keys on the tab row; anything not on a tab (File, AutoSave, quick access) is left alone. */
export function moveBetweenRibbonTabs(e: KeyboardEvent<HTMLElement>): void {
  const current = e.target as HTMLElement
  if (current.getAttribute('role') !== 'tab') return
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
    (tab) => !tab.hasAttribute('disabled'),
  )
  const at = tabs.indexOf(current)
  if (at < 0) return
  const forward = getComputedStyle(e.currentTarget).direction === 'rtl' ? -1 : 1
  const next =
    e.key === 'ArrowRight'
      ? at + forward
      : e.key === 'ArrowLeft'
        ? at - forward
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? tabs.length - 1
            : null
  if (next === null) return
  const tab = tabs[(next + tabs.length) % tabs.length]
  if (!tab) return
  e.preventDefault()
  tab.focus()
  if (tab.getAttribute('aria-selected') !== 'true') tab.click()
}
