import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Spell checking without the network. On Windows and Linux, Chromium checks spelling with
 * Hunspell dictionaries and downloads any it lacks from Google's servers, at startup and
 * whenever a language is picked. The app ships its dictionaries instead: they are copied
 * into <userData>/Dictionaries, where Chromium looks before downloading, and the download
 * address points at the shipped folder, so a language without a dictionary is simply not
 * checked. macOS uses the system spell checker and never downloads.
 */

/** Chromium's dictionary file name: <language>-<major>-<minor>.bdic */
const BDIC_NAME = /^(.+)-\d+-\d+\.bdic$/

/** Folder (under userData) where Chromium looks for a dictionary before downloading one */
export const DICTIONARIES_DIR_NAME = 'Dictionaries'

export function dictionaryLanguage(fileName: string): string | null {
  return BDIC_NAME.exec(fileName)?.[1] ?? null
}

/** Copy the shipped dictionaries into Chromium's folder; an up-to-date copy is left alone */
export function seedSpellDictionaries(bundledDir: string, dictionariesDir: string): void {
  let names: string[]
  try {
    names = readdirSync(bundledDir).filter((name) => dictionaryLanguage(name) !== null)
  } catch {
    return
  }
  if (names.length === 0) return
  try {
    mkdirSync(dictionariesDir, { recursive: true })
  } catch {
    return
  }
  for (const name of names) {
    const source = join(bundledDir, name)
    const target = join(dictionariesDir, name)
    try {
      // A torn copy has the wrong size and is replaced on the next start
      if (statSync(target, { throwIfNoEntry: false })?.size === statSync(source).size) continue
      copyFileSync(source, target)
    } catch {
      // spell checking is best effort; the editor works without it
    }
  }
}

/** Languages with a dictionary on disk: the shipped ones plus any an older version downloaded */
export function installedDictionaryLanguages(dictionariesDir: string): Set<string> {
  try {
    return new Set(
      readdirSync(dictionariesDir).flatMap((name) => {
        const lang = dictionaryLanguage(name)
        return lang ? [lang] : []
      }),
    )
  } catch {
    return new Set()
  }
}

/**
 * The dictionary a Chromium spell-check language code loads, if it is on disk. Codes and
 * file names differ: a bare code loads its regional dictionary (de → de-DE, ru → ru-RU),
 * every Spanish variant shares es-ES, and regional codes load their own (pt-BR, en-GB).
 */
export function dictionaryForLanguage(code: string, installed: Set<string>): string | null {
  if (installed.has(code)) return code
  if (code === 'es' || code.startsWith('es-')) return installed.has('es-ES') ? 'es-ES' : null
  if (code.includes('-')) return null
  for (const lang of installed) if (lang.startsWith(`${code}-`)) return lang
  return null
}

/**
 * Chromium starts spell checking in the system language. When none of the active
 * languages has a dictionary on disk (a German or Arabic Windows, say), nothing is
 * checked and the editor's language menu, which only shows on a misspelled word, cannot
 * be reached. Returns the shipped English dictionary to switch to, or null to keep the
 * active languages.
 */
export function fallbackSpellLanguage(
  active: string[],
  locale: string,
  installed: Set<string>,
  available: string[],
): string | null {
  if (active.some((code) => dictionaryForLanguage(code, installed) !== null)) return null
  const british = /^en[-_](GB|AU|NZ|IE|ZA|IN)\b/i.test(locale)
  for (const code of british ? ['en-GB', 'en-US'] : ['en-US', 'en-GB']) {
    if (installed.has(code) && available.includes(code)) return code
  }
  return null
}

/**
 * Download address for missing dictionaries: the shipped folder, so a request for a
 * language the app does not ship fails locally instead of reaching the network
 */
export function localDictionaryDownloadUrl(bundledDir: string): string {
  const href = pathToFileURL(bundledDir).href
  return href.endsWith('/') ? href : `${href}/`
}
