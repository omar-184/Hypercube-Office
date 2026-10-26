import { describe, expect, it, vi } from 'vitest'
import { PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib'
import {
  decideSignedWrite,
  hasIntactSignature,
  type SignedWriteChoice,
} from '../src/main/signed-guard'

const enc = (s: string) => new TextEncoder().encode(s)
const PLACEHOLDER = 1111111111

/**
 * A one-page PDF signed the way signers lay it out: a /Sig dictionary written uncompressed
 * with a /Contents hex placeholder, whose /ByteRange is then patched in place to frame it
 */
async function signedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage()
  const sig = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    ByteRange: doc.context.obj(
      [PLACEHOLDER, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER].map((n) => PDFNumber.of(n)),
    ),
    Contents: PDFHexString.of('00'.repeat(64)),
  })
  doc.catalog.set(PDFName.of('TestSig'), doc.context.register(sig))
  const bytes = await doc.save({ useObjectStreams: false })
  const text = new TextDecoder('latin1').decode(bytes)
  const gapStart = text.indexOf('<' + '00'.repeat(64) + '>')
  const gapEnd = gapStart + 2 + 128
  const values = [0, gapStart, gapEnd, bytes.length - gapEnd]
  let i = 0
  const patched = text.replace(new RegExp(String(PLACEHOLDER), 'g'), () =>
    String(values[i++]).padStart(String(PLACEHOLDER).length, '0'),
  )
  return Uint8Array.from(patched, (c) => c.charCodeAt(0))
}

describe('hasIntactSignature', () => {
  it('finds a signature whose byte range still frames its /Contents', async () => {
    expect(hasIntactSignature(await signedPdf())).toBe(true)
  })

  it('stays intact after an incremental update appended past the signed revision', async () => {
    const signed = await signedPdf()
    const update = enc('\n2 0 obj\n<< /Type /Annot >>\nendobj\n%%EOF\n')
    const appended = new Uint8Array(signed.length + update.length)
    appended.set(signed)
    appended.set(update, signed.length)
    expect(hasIntactSignature(appended)).toBe(true)
  })

  it('reports a signature already broken by a full rewrite as not intact', async () => {
    const rewritten = await (
      await PDFDocument.load(await signedPdf())
    ).save({
      useObjectStreams: false,
    })
    // the /Sig dictionary and its /ByteRange are still in the file, at moved offsets
    expect(new TextDecoder('latin1').decode(rewritten)).toContain('/ByteRange')
    expect(hasIntactSignature(rewritten)).toBe(false)
  })

  it('ignores unsigned files, placeholders and malformed ranges', () => {
    expect(hasIntactSignature(enc('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj'))).toBe(false)
    expect(hasIntactSignature(new Uint8Array())).toBe(false)
    expect(hasIntactSignature(enc('<< /ByteRange [0 0 0 0] /Contents <00> >>'))).toBe(false)
    expect(hasIntactSignature(enc('<< /ByteRange [0 840 960 240] /Contents <00> >>'))).toBe(false)
    expect(hasIntactSignature(enc('<< /ByteRange [0 /x] >>'))).toBe(false)
    expect(hasIntactSignature(enc('/ByteRange'))).toBe(false)
  })

  it('finds an intact signature after a broken one', () => {
    // a stale range first (say, from a signature an earlier rewrite broke), then a live one
    const hex = '<' + '00'.repeat(16) + '>'
    const head = '%PDF-1.7\n1 0 obj\n<< /ByteRange [0 5 9 1] >>\nendobj\n2 0 obj\n<< /ByteRange ['
    const range = (values: number[]) => values.map((v) => String(v).padStart(10, '0')).join(' ')
    const mid = '] /Contents '
    const tail = ' >>\nendobj\n%%EOF\n'
    const gapStart = head.length + range([0, 0, 0, 0]).length + mid.length
    const gapEnd = gapStart + hex.length
    const total = gapEnd + tail.length
    const text = head + range([0, gapStart, gapEnd, total - gapEnd]) + mid + hex + tail
    expect(hasIntactSignature(enc(text))).toBe(true)
    expect(hasIntactSignature(enc(text.replace('<' + '00', '(' + '00')))).toBe(false)
  })
})

describe('decideSignedWrite', () => {
  const asker = (choice: SignedWriteChoice) => vi.fn(async () => choice)

  it('writes unsigned files without asking', async () => {
    const ask = asker('cancel')
    for (const kind of ['save', 'autosave', 'pageOp'] as const) {
      expect(await decideSignedWrite({ signed: false, acknowledged: false, kind, ask })).toBe(
        'proceed',
      )
    }
    expect(ask).not.toHaveBeenCalled()
  })

  it('does not ask again once the user chose to write anyway', async () => {
    const ask = asker('cancel')
    for (const kind of ['save', 'autosave', 'pageOp'] as const) {
      expect(await decideSignedWrite({ signed: true, acknowledged: true, kind, ask })).toBe(
        'proceed',
      )
    }
    expect(ask).not.toHaveBeenCalled()
  })

  it('never lets autosave write into a signed file, and never interrupts for it', async () => {
    const ask = asker('anyway')
    expect(
      await decideSignedWrite({ signed: true, acknowledged: false, kind: 'autosave', ask }),
    ).toBe('cancel')
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks before a save or page change and follows the answer', async () => {
    const cases: [SignedWriteChoice, string][] = [
      ['anyway', 'proceed'],
      ['copy', 'copy'],
      ['cancel', 'cancel'],
    ]
    for (const kind of ['save', 'pageOp'] as const) {
      for (const [choice, decision] of cases) {
        const ask = asker(choice)
        expect(await decideSignedWrite({ signed: true, acknowledged: false, kind, ask })).toBe(
          decision,
        )
        expect(ask).toHaveBeenCalledWith(kind)
      }
    }
  })
})
