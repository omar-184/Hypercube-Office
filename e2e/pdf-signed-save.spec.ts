import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

const SIGNED_MSG = 'This PDF is digitally signed.'

/** One page carrying a signature value dictionary, written uncompressed the way signers do */
async function signedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 300])
  const sig = pdf.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    ByteRange: pdf.context.obj([0, 0, 0, 0].map((n) => PDFNumber.of(n))),
  })
  pdf.catalog.set(PDFName.of('TestSignature'), pdf.context.register(sig))
  return pdf.save({ useObjectStreams: false })
}

async function freeTexts(path: string): Promise<string[]> {
  const pdf = await PDFDocument.load(await readFile(path))
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return []
  return Array.from({ length: annots.size() }, (_, i) => annots.lookup(i, PDFDict))
    .filter((a) => a.lookup(PDFName.of('Subtype'), PDFName).decodeText() === 'FreeText')
    .map((a) => (a.lookup(PDFName.of('Contents')) as { decodeText(): string }).decodeText())
}

/**
 * Stub the native dialogs: each message box takes the next queued button label and is
 * recorded in `globalThis.__boxes`; Save As picks `copyPath`
 */
async function stubDialogs(app: ElectronApplication, copyPath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const g = globalThis as unknown as { __boxes: string[]; __answers: string[] }
    g.__boxes = []
    g.__answers = []
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (
        args.length === 1 ? args[0] : args[1]
      ) as import('electron').MessageBoxOptions
      g.__boxes.push(options.message ?? '')
      const idx = (options.buttons ?? []).indexOf(g.__answers.shift() ?? '')
      return { response: idx >= 0 ? idx : (options.cancelId ?? 0), checkboxChecked: false }
    }) as never
  }, copyPath)
}

async function answerNext(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate((_electron, l) => {
    ;(globalThis as unknown as { __answers: string[] }).__answers.push(l)
  }, label)
}

async function shownBoxes(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __boxes: string[] }).__boxes)
}

async function addTextBox(editor: Page, text: string, at: number): Promise<void> {
  // The tool button toggles, and the tool stays armed after placing a box
  const tool = editor.getByRole('button', { name: 'Text box', exact: true })
  if (!(await tool.getAttribute('class'))?.split(' ').includes('active')) await tool.click()
  const layer = editor.locator('.pdf-page .pdf-draw-layer').first()
  const box = await layer.boundingBox()
  if (!box) throw new Error('Missing draw layer')
  await editor.mouse.click(box.x + box.width * at, box.y + box.height * at)
  const input = editor.getByRole('textbox', { name: 'Text box' })
  await expect(input).toBeFocused()
  await input.fill(text)
  await input.press('ControlOrMeta+Enter')
  await expect(input).toHaveCount(0)
}

test('saving into a signed PDF asks first; cancel keeps the file, Save Anyway asks once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-signed-save-'))
  const source = join(dir, 'signed.pdf')
  const original = await signedPdf()
  await writeFile(source, original)
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-signed-save',
    openFile: source,
  })
  try {
    await stubDialogs(launched.app, join(dir, 'unused.pdf'))
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await editor.getByRole('tab', { name: 'Annotate', exact: true }).click()
    await addTextBox(editor, 'First note', 0.2)

    // Cancel: the warning shows and the signed file is left byte-identical
    await answerNext(launched.app, 'Cancel')
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => shownBoxes(launched.app)).toEqual([SIGNED_MSG])
    await expect(editor.getByText('Unsaved', { exact: true })).toBeVisible()
    expect(Buffer.compare(await readFile(source), Buffer.from(original))).toBe(0)

    // Save Anyway writes the edits
    await answerNext(launched.app, 'Save Anyway')
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => freeTexts(source)).toEqual(['First note'])
    expect(await shownBoxes(launched.app)).toEqual([SIGNED_MSG, SIGNED_MSG])
    await expect(editor.getByText('Unsaved', { exact: true })).toHaveCount(0)

    // The answer holds for this file in this tab: the next save goes through silently
    await addTextBox(editor, 'Second note', 0.6)
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => freeTexts(source)).toEqual(['First note', 'Second note'])
    expect(await shownBoxes(launched.app)).toEqual([SIGNED_MSG, SIGNED_MSG])
  } finally {
    await closeAndSaveVideo(launched, 'pdf-signed-save')
    await rm(dir, { recursive: true, force: true })
  }
})

test('Save as a Copy keeps the signed original and writes the edits to the copy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-signed-copy-'))
  const source = join(dir, 'signed.pdf')
  const copy = join(dir, 'signed-edited.pdf')
  const original = await signedPdf()
  await writeFile(source, original)
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-signed-save-copy',
    openFile: source,
  })
  try {
    await stubDialogs(launched.app, copy)
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await editor.getByRole('tab', { name: 'Annotate', exact: true }).click()
    await addTextBox(editor, 'Reviewed', 0.3)

    await answerNext(launched.app, 'Save as a Copy…')
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => existsSync(copy) && freeTexts(copy)).toEqual(['Reviewed'])
    expect(await shownBoxes(launched.app)).toEqual([SIGNED_MSG])
    expect(Buffer.compare(await readFile(source), Buffer.from(original))).toBe(0)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-signed-save-copy')
    await rm(dir, { recursive: true, force: true })
  }
})
