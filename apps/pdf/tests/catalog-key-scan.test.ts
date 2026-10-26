import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { mayContainCatalogKey } from '../src/main/catalog-key-scan'

const enc = (s: string) => new TextEncoder().encode(s)
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const objStm = (dict: string, data: Uint8Array) =>
  concat(enc(`%PDF-1.7\n5 0 obj\n<< ${dict} >>\nstream\n`), data, enc('\nendstream\nendobj\n'))

describe('mayContainCatalogKey', () => {
  it('finds a key visible in the raw bytes', async () => {
    expect(await mayContainCatalogKey(enc('<< /Type /Catalog /MyKey <00> >>'), 'MyKey')).toBe(true)
  })

  it('rules out a file without the key and without object streams', async () => {
    expect(await mayContainCatalogKey(enc('%PDF-1.7\n<< /Type /Catalog >>'), 'MyKey')).toBe(false)
  })

  it('looks inside FlateDecode object streams', async () => {
    const hit = deflateSync(enc('1 0 << /Type /Catalog /MyKey <00> >>'))
    const miss = deflateSync(enc('1 0 << /Type /Catalog >>'))
    const dict = (n: number) => `/Type /ObjStm /N 1 /First 4 /Length ${n} /Filter /FlateDecode`
    expect(await mayContainCatalogKey(objStm(dict(hit.length), hit), 'MyKey')).toBe(true)
    expect(await mayContainCatalogKey(objStm(dict(miss.length), miss), 'MyKey')).toBe(false)
    // an indirect /Length falls back to the endstream keyword
    expect(
      await mayContainCatalogKey(
        objStm('/Type /ObjStm /Length 9 0 R /Filter /FlateDecode', hit),
        'MyKey',
      ),
    ).toBe(true)
  })

  it('answers "may contain" for streams it cannot read with confidence', async () => {
    const data = deflateSync(enc('1 0 << /Type /Catalog >>'))
    // predictors or other filters, and data that does not inflate
    expect(
      await mayContainCatalogKey(
        objStm(
          `/Type /ObjStm /Length ${data.length} /Filter /FlateDecode /DecodeParms << /Predictor 12 >>`,
          data,
        ),
        'MyKey',
      ),
    ).toBe(true)
    expect(
      await mayContainCatalogKey(
        objStm('/Type /ObjStm /Length 4 /Filter /LZWDecode', enc('abcd')),
        'MyKey',
      ),
    ).toBe(true)
    expect(
      await mayContainCatalogKey(
        objStm('/Type /ObjStm /Length 4 /Filter /FlateDecode', enc('abcd')),
        'MyKey',
      ),
    ).toBe(true)
  })
})
