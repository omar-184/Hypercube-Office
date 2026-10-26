/**
 * Keys that switch document tabs. Ctrl+Tab and Ctrl+Shift+Tab work from every
 * view. Ctrl+PageDown/PageUp and Ctrl+1-9 (Cmd+1-9 on macOS) work only from
 * the shell's own page (Home and the tab strip): inside an editor they keep
 * their Office meanings, such as Ctrl+1 for Format Cells, Ctrl+2 for double
 * spacing and Ctrl+PageDown for the next sheet.
 */
import type { Input } from 'electron'

export type TabKeyAction = { cycle: 1 | -1 } | { index: number } | { last: true }

type KeyInput = Pick<Input, 'type' | 'key' | 'code' | 'control' | 'meta' | 'shift' | 'alt'>

export function tabKeyAction(
  input: KeyInput,
  where: { inEditor: boolean; mac: boolean },
): TabKeyAction | null {
  // AltGr arrives as Ctrl+Alt on Windows and types characters
  if (input.type !== 'keyDown' || input.alt) return null
  if (input.key === 'Tab' && input.control && !input.meta) {
    return { cycle: input.shift ? -1 : 1 }
  }
  if (where.inEditor) return null
  if (input.control && !input.meta && !input.shift) {
    if (input.key === 'PageDown') return { cycle: 1 }
    if (input.key === 'PageUp') return { cycle: -1 }
  }
  const mod = where.mac ? input.meta && !input.control : input.control && !input.meta
  const digit = /^Digit([1-9])$/.exec(input.code)
  if (mod && !input.shift && digit) {
    // as in browsers: 1-8 pick that tab, 9 the last one
    return digit[1] === '9' ? { last: true } : { index: Number(digit[1]) - 1 }
  }
  return null
}
