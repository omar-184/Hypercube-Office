import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as m from 'mupdf'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileInfo, freePath, runRequest } from '../src/main/pdf-tools/jobs'

m.setLog(null)

function makePdf(pages: number): Uint8Array {
  const doc = new m.PDFDocument()
  const font = doc.addSimpleFont(new m.Font('Helvetica'))
  for (let i = 0; i < pages; i++) {
    const res = doc.addObject({ Font: { F1: font } })
    doc.insertPage(
      -1,
      doc.addPage([0, 0, 300, 400], 0, res, `BT /F1 20 Tf 40 300 Td (Page ${i + 1}) Tj ET`),
    )
  }
  const bytes = doc.saveToBuffer('compress').asUint8Array().slice()
  doc.destroy()
  return bytes
}

function pageCount(path: string): number {
  const doc = new m.PDFDocument(new Uint8Array(readFileSync(path)))
  const n = doc.countPages()
  doc.destroy()
  return n
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdf-tools-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('pdf tools jobs', () => {
  it('merges beside the first input without overwriting', () => {
    writeFileSync(join(dir, 'a.pdf'), makePdf(2))
    writeFileSync(join(dir, 'b.pdf'), makePdf(3))
    writeFileSync(join(dir, 'a-merged.pdf'), 'taken')
    const res = runRequest(m, {
      tool: 'merge',
      files: [{ path: join(dir, 'a.pdf') }, { path: join(dir, 'b.pdf'), pages: '1' }],
      options: {},
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const out = res.items[0].outputs[0].path
    expect(out).toBe(join(dir, 'a-merged (2).pdf'))
    expect(pageCount(out)).toBe(3)
    expect(readFileSync(join(dir, 'a-merged.pdf'), 'utf8')).toBe('taken')
  })

  it('puts many outputs of one file in their own folder and reports progress', () => {
    writeFileSync(join(dir, 'book.pdf'), makePdf(3))
    writeFileSync(join(dir, 'notes.pdf'), makePdf(1))
    const progress: number[] = []
    const res = runRequest(
      m,
      {
        tool: 'split',
        files: [{ path: join(dir, 'book.pdf') }, { path: join(dir, 'notes.pdf') }],
        options: { kind: 'every', size: 1 },
      },
      (p) => progress.push(p.done),
    )
    expect(progress).toEqual([1, 2])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(readdirSync(join(dir, 'book-split')).sort()).toEqual([
      'book-page-1.pdf',
      'book-page-2.pdf',
      'book-page-3.pdf',
    ])
    // a single output stays beside its input
    expect(res.items[1].outputs.map((o) => o.path)).toEqual([join(dir, 'notes-page-1.pdf')])
  })

  it('reports a per-file error and keeps going', () => {
    writeFileSync(join(dir, 'ok.pdf'), makePdf(2))
    writeFileSync(join(dir, 'bad.pdf'), 'not a pdf')
    const res = runRequest(m, {
      tool: 'rotate',
      files: [{ path: join(dir, 'bad.pdf') }, { path: join(dir, 'ok.pdf') }],
      options: { angle: 90, pages: '' },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items[0].error?.code).toBe('not-pdf')
    expect(res.items[1].outputs).toHaveLength(1)
  })

  it('maps a bad page range to bad-pages', () => {
    writeFileSync(join(dir, 'x.pdf'), makePdf(2))
    const res = runRequest(m, {
      tool: 'delete',
      files: [{ path: join(dir, 'x.pdf') }],
      options: { pages: '7' },
    })
    expect(res.ok && res.items[0].error?.code).toBe('bad-pages')
  })

  it('writes to a chosen folder', () => {
    const out = mkdtempSync(join(tmpdir(), 'pdf-tools-out-'))
    writeFileSync(join(dir, 'x.pdf'), makePdf(1))
    const res = runRequest(m, {
      tool: 'compress',
      files: [{ path: join(dir, 'x.pdf') }],
      options: { level: 'balanced' },
      outputDir: out,
    })
    expect(res.ok && res.items[0].outputs[0].path).toBe(join(out, 'x-compressed.pdf'))
    expect(res.ok && res.items[0].originalSize).toBeGreaterThan(0)
    rmSync(out, { recursive: true, force: true })
  })

  it('describes PDFs and asks for a password when one is needed', () => {
    const locked = new m.PDFDocument(makePdf(2))
    writeFileSync(
      join(dir, 'locked.pdf'),
      locked.saveToBuffer('encrypt=aes-256,user-password=pw,owner-password=pw').asUint8Array(),
    )
    expect(fileInfo(m, join(dir, 'locked.pdf'))).toMatchObject({
      ok: false,
      error: { code: 'password-required' },
    })
    expect(fileInfo(m, join(dir, 'locked.pdf'), 'pw')).toMatchObject({
      ok: true,
      kind: 'pdf',
      pages: 2,
      encrypted: true,
    })
    writeFileSync(join(dir, 'photo.jpg'), 'x')
    expect(fileInfo(m, join(dir, 'photo.jpg'))).toMatchObject({ ok: true, kind: 'image' })
  })

  it('stops between files when canceled and reports the ones it finished', () => {
    const files = ['a', 'b', 'c'].map((n) => {
      writeFileSync(join(dir, `${n}.pdf`), makePdf(1))
      return { path: join(dir, `${n}.pdf`) }
    })
    let stop = false
    const streamed: string[] = []
    const res = runRequest(
      m,
      { tool: 'rotate', files, options: { angle: 90, pages: '' } },
      () => {},
      {
        // the cancel lands while the first file is being written
        onItem: (item) => {
          streamed.push(item.source)
          stop = true
        },
        control: { canceled: () => stop, beginWrite: () => !stop, endWrite: () => {} },
      },
    )
    expect(res).toMatchObject({ ok: true, canceled: true })
    expect(res.ok && res.items.map((i) => i.source)).toEqual([files[0].path])
    expect(streamed).toEqual([files[0].path])
    expect(readdirSync(dir).filter((f) => !['a.pdf', 'b.pdf', 'c.pdf'].includes(f))).toHaveLength(1)
  })

  it('writes nothing once canceled, even when the work itself is done', () => {
    writeFileSync(join(dir, 'x.pdf'), makePdf(1))
    const res = runRequest(
      m,
      { tool: 'compress', files: [{ path: join(dir, 'x.pdf') }], options: { level: 'balanced' } },
      () => {},
      { control: { canceled: () => false, beginWrite: () => false, endWrite: () => {} } },
    )
    expect(res).toEqual({ ok: true, items: [], canceled: true })
    expect(readdirSync(dir)).toEqual(['x.pdf'])
  })

  it('numbers clashing names', () => {
    writeFileSync(join(dir, 'r.pdf'), '')
    expect(freePath(dir, 'r.pdf')).toBe(join(dir, 'r (2).pdf'))
    expect(freePath(dir, 'r.pdf', new Set([join(dir, 'r (2).pdf')]))).toBe(join(dir, 'r (3).pdf'))
  })
})
