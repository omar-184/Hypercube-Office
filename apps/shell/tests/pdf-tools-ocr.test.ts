/**
 * End to end for the PDF Tools OCR job: a scanned PDF on disk goes through
 * runRequest (the code the tools worker runs) and comes back as a searchable
 * copy. On Windows the real system OCR helper does the recognition (the CI
 * "ocr-windows" job); elsewhere a stand-in engine covers the same path.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as m from 'mupdf'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OcrRecognizer } from '@genoffice/pdf-tools'
import { createWindowsOcrEngine } from '../../../packages/pdf2docx/src/ocr-vision'
import { runRequest } from '../src/main/pdf-tools/jobs'

m.setLog(null)

const helperDir = join(__dirname, '../../../packages/pdf2docx/ocr-helper')
const helper = join(helperDir, 'win-ocr.exe')
/** English sample text on white, 830 x 300 px (the helper's own smoke fixture) */
const fixture = readFileSync(join(helperDir, 'fixtures', 'smoke-en.png'))

/** Page 1 is real text; page 2 is the fixture image alone, as a scanner makes it. */
function scannedPdf(): Uint8Array {
  const doc = new m.PDFDocument()
  const font = doc.addSimpleFont(new m.Font('Helvetica'))
  const textRes = doc.addObject({ Font: { F1: font } })
  doc.insertPage(
    -1,
    doc.addPage(
      [0, 0, 415, 150],
      0,
      textRes,
      'BT /F1 14 Tf 20 100 Td (Cover page of the report) Tj ET',
    ),
  )
  const res = doc.addObject({ XObject: { Im0: doc.addImage(new m.Image(fixture)) } })
  doc.insertPage(-1, doc.addPage([0, 0, 415, 150], 0, res, 'q 415 0 0 150 0 0 cm /Im0 Do Q'))
  const bytes = doc.saveToBuffer('compress').asUint8Array().slice()
  doc.destroy()
  return bytes
}

function pageText(path: string, index: number): string {
  const doc = new m.PDFDocument(new Uint8Array(readFileSync(path)))
  const page = doc.loadPage(index)
  const st = page.toStructuredText('')
  const text = st.asText()
  st.destroy()
  page.destroy()
  doc.destroy()
  return text
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdf-tools-ocr-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function runOcr(ocr: OcrRecognizer | null) {
  const src = join(dir, 'scan.pdf')
  writeFileSync(src, scannedPdf())
  // pages of the scan, as OCR reports them
  const progress: [number, number][] = []
  const res = runRequest(
    m,
    { tool: 'ocr', files: [{ path: src }], options: { pages: '' } },
    (p) => p.pagesTotal !== undefined && progress.push([p.pagesDone ?? 0, p.pagesTotal]),
    { ocr },
  )
  return { res, progress }
}

describe('PDF Tools OCR job', () => {
  it('writes a searchable copy beside the scan', () => {
    const stand: OcrRecognizer = () => ({
      lines: [
        {
          text: 'The quick brown fox',
          confidence: 0.9,
          box: { x0: 0.1, y0: 0.5, x1: 0.6, y1: 0.6 },
        },
      ],
    })
    const { res, progress } = runOcr(stand)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const item = res.items[0]
    expect(item.error).toBeUndefined()
    expect(item.outputs[0].path).toBe(join(dir, 'scan-searchable.pdf'))
    expect(pageText(item.outputs[0].path, 0)).toContain('Cover page of the report')
    expect(pageText(item.outputs[0].path, 1)).toContain('The quick brown fox')
    expect(progress.at(-1)).toEqual([1, 1])
  })

  it('explains when the computer has no OCR engine', () => {
    const { res } = runOcr(null)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items[0].outputs).toEqual([])
    expect(res.items[0].error?.code).toBe('unsupported')
    expect(res.items[0].error?.message).toMatch(/not available on this computer/)
  })

  it.runIf(process.platform === 'win32')(
    'recognizes a scanned page with the Windows OCR engine',
    (ctx) => {
      expect(existsSync(helper), 'build win-ocr.exe first (ocr-helper/build-win.mjs)').toBe(true)
      // a runner image without an OCR language makes the helper exit 4
      const probe = spawnSync(helper, [], { input: fixture, timeout: 60_000 })
      if (probe.status === 4) {
        if (process.env.HF_REQUIRE_OCR === '1') {
          throw new Error(`no OCR language installed: ${probe.stderr.toString()}`)
        }
        console.warn('no OCR language on this machine; real recognition not checked')
        ctx.skip()
      }
      const engine = createWindowsOcrEngine(helper)
      const { res } = runOcr(engine)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      const item = res.items[0]
      expect(item.error).toBeUndefined()
      const out = item.outputs[0].path
      const text = pageText(out, 1)
      expect(text).toMatch(/quick/i)
      expect(text).toMatch(/12345/)
      expect(pageText(out, 0)).toContain('Cover page of the report')

      // the hidden word sits over the printed one: "quick" is in the top half, left of center
      const doc = new m.PDFDocument(new Uint8Array(readFileSync(out)))
      const page = doc.loadPage(1)
      const st = page.toStructuredText('')
      const hits = st.search('quick', '')
      expect(hits.length).toBeGreaterThan(0)
      const [x, y] = hits[0][0]
      expect(x).toBeGreaterThan(40)
      expect(x).toBeLessThan(207)
      expect(y).toBeLessThan(75)
      st.destroy()
      page.destroy()
      doc.destroy()
    },
    120_000,
  )
})
