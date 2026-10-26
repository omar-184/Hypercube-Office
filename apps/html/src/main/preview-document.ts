export const PREVIEW_SCHEME = 'html-preview'
export const ASSET_SCHEME = 'html-asset'

/** Encode an absolute directory as an html-asset base URL with a trailing slash.
 * The scheme is registered as standard, so it needs a host: `view-<id>` names the editor
 * view the preview belongs to (the asset handler applies that view's web-content choice
 * to the local documents a page frames), `local` is a neutral placeholder. */
export function assetBaseHref(documentDir: string, viewId?: number): string {
  const normalized = documentDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
    .join('/')
  return `${ASSET_SCHEME}://${viewId === undefined ? 'local' : `view-${viewId}`}${encoded}/`
}

/**
 * The preview copy of the document: the buffer text with a <base> pointing at
 * the document's directory (so relative assets resolve through html-asset://)
 * unless the author already declared one. The saved file never contains it.
 */
interface TagRange {
  start: number
  end: number
}

function tagEnd(text: string, start: number): number {
  let quote = ''
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '>') return index + 1
  }
  return -1
}

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title'])

function skipRawText(text: string, index: number, tagName: string): number {
  const closing = new RegExp(`</${tagName}\\s*>`, 'i').exec(text.slice(index))
  return closing ? index + closing.index + closing[0].length : text.length
}

function skipTemplate(text: string, index: number): number {
  let depth = 1
  while (index < text.length) {
    const start = text.indexOf('<', index)
    if (start < 0) return text.length
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4)
      index = end < 0 ? text.length : end + 3
      continue
    }
    if (text.startsWith('<!', start) || text.startsWith('<?', start)) {
      const end = tagEnd(text, start)
      index = end < 0 ? text.length : end
      continue
    }
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(text.slice(start))
    if (!match) {
      index = start + 1
      continue
    }
    const end = tagEnd(text, start)
    if (end < 0) return text.length
    const closing = match[1] === '/'
    const tagName = match[2].toLowerCase()
    if (tagName === 'template') {
      if (closing) {
        depth -= 1
        if (depth === 0) return end
      } else {
        depth += 1
      }
    }
    index = end
    if (!closing && RAW_TEXT_TAGS.has(tagName)) index = skipRawText(text, index, tagName)
  }
  return text.length
}

function openingTag(text: string, name: string): TagRange | null {
  let index = 0
  while (index < text.length) {
    const start = text.indexOf('<', index)
    if (start < 0) return null
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4)
      index = end < 0 ? text.length : end + 3
      continue
    }
    if (text.startsWith('<!', start) || text.startsWith('<?', start)) {
      const end = tagEnd(text, start)
      index = end < 0 ? text.length : end
      continue
    }
    const match = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(text.slice(start))
    if (!match) {
      index = start + 1
      continue
    }
    const end = tagEnd(text, start)
    if (end < 0) return null
    const tagName = match[1].toLowerCase()
    if (tagName === name.toLowerCase()) return { start, end }
    if (tagName === 'template') {
      index = skipTemplate(text, end)
      continue
    }
    index = end
    if (RAW_TEXT_TAGS.has(tagName)) index = skipRawText(text, index, tagName)
  }
  return null
}

/** End of a leading doctype (after whitespace and comments), or 0: anything placed before
 * the doctype would switch the page to quirks mode */
function leadingDoctypeEnd(text: string): number {
  return /^(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(text)?.[0].length ?? 0
}

/**
 * Content policy for a preview whose web content is blocked: the document's own inline
 * code and its local files (html-asset:, data:, blob:) load, nothing from the network does.
 * An author's own policy can only narrow this further. A local document the page frames
 * (an SVG chart in an <object>) gets the same policy from the asset handler, since a
 * framed file does not inherit its parent's.
 */
export const BLOCK_REMOTE_CSP = [
  "default-src html-preview: html-asset: data: blob: 'unsafe-inline' 'unsafe-eval'",
  'form-action html-preview: html-asset:',
].join('; ')

/**
 * Runs first in a preview with web content blocked and counts what the policy refused, so
 * the inspector (inspector.js, appended later) can offer to load it. Only network
 * addresses count; an author policy refusing local content is not ours to offer.
 */
export const REMOTE_GUARD_SCRIPT =
  '<script data-gx-inspector>(() => {' +
  'const state = { count: 0, notify: null };' +
  'window.__gxRemoteBlocked = state;' +
  // No content policy covers WebRTC: take the constructors away while web content is
  // blocked (the editor views also refuse non-proxied UDP, see html-main.ts)
  "for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {" +
  'try { Object.defineProperty(window, name, { value: undefined, configurable: false }) } catch {}' +
  '}' +
  "document.addEventListener('securitypolicyviolation', (e) => {" +
  'if (!/^(https?|wss?):/i.test(e.blockedURI)) return;' +
  'state.count += 1;' +
  'if (state.notify) state.notify();' +
  '});' +
  '})()</script>'

export function buildPreviewDocument(
  text: string,
  baseHref: string | null,
  /** markup placed at the top of the head, after the base, so it runs before any content */
  headMarkup = '',
): string {
  const base =
    baseHref && !openingTag(text, 'base') ? `<base href="${baseHref.replace(/"/g, '%22')}">` : ''
  const inject = base + headMarkup
  if (!inject) return text
  const at =
    openingTag(text, 'head')?.end ?? openingTag(text, 'html')?.end ?? leadingDoctypeEnd(text)
  return text.slice(0, at) + inject + text.slice(at)
}

export function previewUrlFor(webContentsId: number): string {
  return `${PREVIEW_SCHEME}://view-${webContentsId}/`
}
