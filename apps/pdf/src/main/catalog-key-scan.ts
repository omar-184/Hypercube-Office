import { promisify } from 'node:util'
import { inflate } from 'node:zlib'
import { containsAscii, indexOfAscii } from '../shared/ascii-search'

const inflateAsync = promisify(inflate)
const decoder = new TextDecoder('latin1')

/**
 * Whether a private catalog key may be in the file, answered without a full parse (which
 * blocks the shared main process for seconds on a large file). The app's own saves write
 * the catalog uncompressed, so the key is usually visible in the raw bytes. Another
 * program re-saving the file may move the catalog into a compressed object stream: those
 * streams hold only small dictionaries, so they are inflated and searched. True means "may
 * be there" (also when a stream cannot be read with confidence), false means "is not".
 */
export async function mayContainCatalogKey(bytes: Uint8Array, key: string): Promise<boolean> {
  if (containsAscii(bytes, key)) return true
  const marker = '/ObjStm'
  for (let at = indexOfAscii(bytes, marker); at !== -1; at = indexOfAscii(bytes, marker, at + 1)) {
    const data = objectStreamData(bytes, at)
    if (!data) return true
    try {
      if (containsAscii(new Uint8Array(await inflateAsync(data.bytes)), key)) return true
    } catch {
      return true
    }
  }
  return false
}

/**
 * The compressed data of the object stream whose dictionary contains `markerAt`, or null
 * when it is not a plain FlateDecode stream this scan can read
 */
function objectStreamData(bytes: Uint8Array, markerAt: number): { bytes: Uint8Array } | null {
  const dictStart = lastIndexOfAscii(bytes, '<<', markerAt)
  const keyword = indexOfAscii(bytes, 'stream', markerAt)
  if (dictStart === -1 || keyword === -1 || keyword - dictStart > 4096) return null
  const dict = decoder.decode(bytes.subarray(dictStart, keyword))
  // Predictors and other filters would need a real decoder: leave those to the full parse
  if (!/\/Filter\s*(\[\s*)?\/FlateDecode\s*\]?/.test(dict) || /\/DecodeParms/.test(dict)) {
    return null
  }
  let start = keyword + 'stream'.length
  if (bytes[start] === 0x0d) start++
  if (bytes[start] === 0x0a) start++
  const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)
  if (direct) {
    const end = start + Number(direct[1])
    return end <= bytes.length ? { bytes: bytes.subarray(start, end) } : null
  }
  const end = indexOfAscii(bytes, 'endstream', start)
  return end === -1 ? null : { bytes: bytes.subarray(start, end) }
}

function lastIndexOfAscii(bytes: Uint8Array, text: string, before: number): number {
  // a negative fromIndex would make lastIndexOf count from the end
  if (before <= 0) return -1
  const first = text.charCodeAt(0)
  for (
    let at = bytes.lastIndexOf(first, before - 1);
    at !== -1;
    at = bytes.lastIndexOf(first, at - 1)
  ) {
    let match = true
    for (let i = 1; i < text.length; i++) {
      if (bytes[at + i] !== text.charCodeAt(i)) {
        match = false
        break
      }
    }
    if (match) return at
    if (at === 0) break
  }
  return -1
}
