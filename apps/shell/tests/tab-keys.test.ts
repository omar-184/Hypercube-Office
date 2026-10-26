import { describe, expect, it } from 'vitest'
import { tabKeyAction } from '../src/main/tab-keys'

const key = (over: Partial<Parameters<typeof tabKeyAction>[0]>) => ({
  type: 'keyDown' as const,
  key: '',
  code: '',
  control: false,
  meta: false,
  shift: false,
  alt: false,
  ...over,
})
const home = { inEditor: false, mac: false }
const editor = { inEditor: true, mac: false }

describe('tab switching keys', () => {
  it('Ctrl+Tab and Ctrl+Shift+Tab cycle from anywhere, editors included', () => {
    expect(tabKeyAction(key({ key: 'Tab', control: true }), editor)).toEqual({ cycle: 1 })
    expect(tabKeyAction(key({ key: 'Tab', control: true, shift: true }), editor)).toEqual({
      cycle: -1,
    })
    expect(tabKeyAction(key({ key: 'Tab', control: true }), { inEditor: true, mac: true })).toEqual(
      { cycle: 1 },
    )
  })

  it('leaves Office shortcuts to the editors', () => {
    // Ctrl+1 Format Cells, Ctrl+2 double spacing, Ctrl+PageDown next sheet
    expect(tabKeyAction(key({ code: 'Digit1', key: '1', control: true }), editor)).toBeNull()
    expect(tabKeyAction(key({ code: 'Digit2', key: '2', control: true }), editor)).toBeNull()
    expect(tabKeyAction(key({ key: 'PageDown', control: true }), editor)).toBeNull()
  })

  it('on Home and the strip, Ctrl+PageDown/PageUp cycle and Ctrl+1-9 pick a tab', () => {
    expect(tabKeyAction(key({ key: 'PageDown', control: true }), home)).toEqual({ cycle: 1 })
    expect(tabKeyAction(key({ key: 'PageUp', control: true }), home)).toEqual({ cycle: -1 })
    expect(tabKeyAction(key({ code: 'Digit1', key: '1', control: true }), home)).toEqual({
      index: 0,
    })
    expect(tabKeyAction(key({ code: 'Digit8', key: '8', control: true }), home)).toEqual({
      index: 7,
    })
    expect(tabKeyAction(key({ code: 'Digit9', key: '9', control: true }), home)).toEqual({
      last: true,
    })
    // macOS uses Cmd for the digits
    expect(
      tabKeyAction(key({ code: 'Digit2', key: '2', meta: true }), { inEditor: false, mac: true }),
    ).toEqual({ index: 1 })
    expect(
      tabKeyAction(key({ code: 'Digit2', key: '2', control: true }), {
        inEditor: false,
        mac: true,
      }),
    ).toBeNull()
  })

  it('ignores key-up, AltGr, plain Tab and Shift+digits', () => {
    expect(tabKeyAction(key({ type: 'keyUp', key: 'Tab', control: true }), home)).toBeNull()
    expect(tabKeyAction(key({ key: 'Tab', control: true, alt: true }), home)).toBeNull()
    expect(tabKeyAction(key({ key: 'Tab' }), home)).toBeNull()
    expect(
      tabKeyAction(key({ code: 'Digit3', key: '#', control: true, shift: true }), home),
    ).toBeNull()
    expect(tabKeyAction(key({ code: 'Digit0', key: '0', control: true }), home)).toBeNull()
  })
})
