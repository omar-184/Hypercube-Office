// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ribbonPanelProps, ribbonTabListProps, ribbonTabProps } from '../src/ribbon-tabs'

let root: Root | null = null
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A tab row like the editors': File and a quick-access button first, then the tabs. */
function Row({ rtl = false }: { rtl?: boolean }) {
  const [tab, setTab] = useState('home')
  return createElement(
    'div',
    null,
    createElement(
      'div',
      { ...ribbonTabListProps('en'), style: rtl ? { direction: 'rtl' } : undefined },
      createElement('button', { className: 'file' }, 'File'),
      ...['home', 'insert', 'Page Layout', 'view'].map((name) =>
        createElement(
          'button',
          { key: name, ...ribbonTabProps(name, tab === name), onClick: () => setTab(name) },
          name,
        ),
      ),
    ),
    createElement('div', ribbonPanelProps(tab), `band for ${tab}`),
  )
}

function mount(rtl = false): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(createElement(Row, { rtl })))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

const tabs = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[role="tab"]')]
const selected = (c: HTMLElement) => c.querySelector('[aria-selected="true"]')?.textContent
const press = (el: Element, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })

describe('ribbon tabs', () => {
  it('is a named tablist whose selected tab is the only Tab stop and labels the band', () => {
    const c = mount()
    expect(c.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Ribbon tabs')
    expect(tabs(c).map((t) => t.tabIndex)).toEqual([0, -1, -1, -1])
    const panel = c.querySelector('[role="tabpanel"]')!
    expect(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'home',
    )
    // a name with a space still makes one IDREF
    expect(tabs(c)[2].id).toBe('ribbon-tab-Page-Layout')
  })

  it('arrows and Home/End select a tab and move focus to it, wrapping at the ends', () => {
    const c = mount()
    tabs(c)[0].focus()
    press(document.activeElement!, 'ArrowRight')
    expect(selected(c)).toBe('insert')
    expect(document.activeElement?.textContent).toBe('insert')
    press(document.activeElement!, 'End')
    expect(selected(c)).toBe('view')
    press(document.activeElement!, 'ArrowRight')
    expect(selected(c)).toBe('home')
    press(document.activeElement!, 'ArrowLeft')
    expect(selected(c)).toBe('view')
    press(document.activeElement!, 'Home')
    expect(selected(c)).toBe('home')
    expect(tabs(c).map((t) => t.tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('reverses the arrows right to left, and leaves keys on other row buttons alone', () => {
    const c = mount(true)
    tabs(c)[0].focus()
    press(document.activeElement!, 'ArrowLeft')
    expect(selected(c)).toBe('insert')
    const file = c.querySelector<HTMLElement>('.file')!
    file.focus()
    press(file, 'ArrowRight')
    expect(selected(c)).toBe('insert')
    expect(document.activeElement).toBe(file)
  })
})
