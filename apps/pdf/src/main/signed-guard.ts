import { indexOfAscii } from '../shared/ascii-search'

/**
 * A certificate signature covers the exact bytes of the file, and every write path here
 * rewrites the whole file, so writing into a signed PDF silently invalidates its
 * signature. This module decides when to ask first.
 */

const BYTE_RANGE = '/ByteRange'
const LT = 0x3c
const GT = 0x3e

const isPdfWhitespace = (b: number | undefined): boolean =>
  b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00

/** The four integers of `/ByteRange [a b c d]` starting at `from`, or null if malformed */
function parseByteRange(bytes: Uint8Array, from: number): number[] | null {
  let at = from
  const end = Math.min(bytes.length, from + 128)
  while (at < end && isPdfWhitespace(bytes[at])) at++
  if (bytes[at] !== 0x5b) return null // [
  at++
  const values: number[] = []
  while (at < end) {
    while (at < end && isPdfWhitespace(bytes[at])) at++
    if (bytes[at] === 0x5d) break // ]
    let value = 0
    let digits = 0
    while (at < end && bytes[at]! >= 0x30 && bytes[at]! <= 0x39) {
      value = value * 10 + (bytes[at]! - 0x30)
      digits++
      at++
    }
    if (digits === 0) return null
    values.push(value)
  }
  return bytes[at] === 0x5d && values.length === 4 ? values : null
}

/**
 * Every signature value dictionary carries /ByteRange [0 b c d]: the signed bytes are
 * [0, b) and [c, c + d), and the gap between them is exactly the /Contents hex string
 * that holds the signature. Signers write it uncompressed, because they patch these
 * offsets in place after laying out the file, so a native byte search finds it without
 * parsing. A signature counts as intact only while those offsets still frame a hex
 * string: any full rewrite (all of this app's saves) moves the bytes, which leaves the
 * signature already broken and nothing left to protect. Later incremental updates keep
 * the signed revision in place, so c + d may stop short of the file's end.
 */
export function hasIntactSignature(bytes: Uint8Array): boolean {
  for (
    let at = indexOfAscii(bytes, BYTE_RANGE);
    at !== -1;
    at = indexOfAscii(bytes, BYTE_RANGE, at + BYTE_RANGE.length)
  ) {
    const range = parseByteRange(bytes, at + BYTE_RANGE.length)
    if (!range) continue
    const [start, gapStart, gapEnd, tail] = range as [number, number, number, number]
    if (
      start === 0 &&
      gapStart > 0 &&
      gapEnd > gapStart + 1 &&
      gapEnd + tail <= bytes.length &&
      bytes[gapStart] === LT &&
      bytes[gapEnd - 1] === GT
    )
      return true
  }
  return false
}

/** What wants to write into the open file */
export type SignedWriteKind = 'save' | 'autosave' | 'pageOp'

/** The user's answer to the warning */
export type SignedWriteChoice = 'copy' | 'anyway' | 'cancel'

/** proceed: write as asked; copy: write nothing, offer Save As; cancel: write nothing */
export type SignedWriteDecision = 'proceed' | 'copy' | 'cancel'

export async function decideSignedWrite(args: {
  /** the file, as last read by this view, carries a signature */
  signed: boolean
  /** the user already chose to overwrite this signed file in this view */
  acknowledged: boolean
  kind: SignedWriteKind
  ask: (kind: Exclude<SignedWriteKind, 'autosave'>) => Promise<SignedWriteChoice>
}): Promise<SignedWriteDecision> {
  const { signed, acknowledged, kind, ask } = args
  if (!signed || acknowledged) return 'proceed'
  // Autosave never asks (it would interrupt every 30 seconds) and never writes: the
  // signed file keeps its pending edits until the user saves explicitly
  if (kind === 'autosave') return 'cancel'
  const choice = await ask(kind)
  return choice === 'anyway' ? 'proceed' : choice
}
