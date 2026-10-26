/**
 * The app ships only English spell-check dictionaries and never downloads one. On a
 * system whose language has no dictionary, Chromium would start spell checking in that
 * language and check nothing: the shell switches such sessions to English instead.
 * Skipped on macOS, which uses the system spell checker.
 */
import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo } from './helpers'

test('a German system starts spell checking in English instead of checking nothing', async () => {
  test.skip(process.platform === 'darwin', 'macOS uses the system spell checker')
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'spellcheck-language-fallback',
    env: { LANG: 'de_DE.UTF-8', LANGUAGE: 'de', LC_ALL: 'de_DE.UTF-8' },
  })
  try {
    const locale = await launched.app.evaluate(({ app }) => app.getLocale())
    expect(locale.startsWith('de')).toBe(true)
    await expect
      .poll(() =>
        launched.app.evaluate(({ session }) => session.defaultSession.getSpellCheckerLanguages()),
      )
      .toEqual(['en-US'])
  } finally {
    await closeAndSaveVideo(launched, 'spellcheck-language-fallback')
  }
})
