import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

const FLUSH_MSG = 'Save your changes first?'

async function onePagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 300])
  return pdf.save()
}

async function pageCount(path: string): Promise<number> {
  return (await PDFDocument.load(await readFile(path))).getPageCount()
}

async function freeTexts(path: string): Promise<string[]> {
  const pdf = await PDFDocument.load(await readFile(path))
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return []
  return Array.from({ length: annots.size() }, (_, i) => annots.lookup(i, PDFDict))
    .filter((a) => a.lookup(PDFName.of('Subtype'), PDFName).decodeText() === 'FreeText')
    .map((a) => (a.lookup(PDFName.of('Contents')) as { decodeText(): string }).decodeText())
}

/** Each message box takes the next queued button label and is recorded in `__boxes` */
async function stubMessageBoxes(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __boxes: string[]; __answers: string[] }
    g.__boxes = []
    g.__answers = []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (
        args.length === 1 ? args[0] : args[1]
      ) as import('electron').MessageBoxOptions
      g.__boxes.push(options.message ?? '')
      const idx = (options.buttons ?? []).indexOf(g.__answers.shift() ?? '')
      return { response: idx >= 0 ? idx : (options.cancelId ?? 0), checkboxChecked: false }
    }) as never
  })
}

async function answerNext(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate((_electron, l) => {
    ;(globalThis as unknown as { __answers: string[] }).__answers.push(l)
  }, label)
}

async function shownBoxes(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __boxes: string[] }).__boxes)
}

async function addTextBox(editor: Page, text: string): Promise<void> {
  await editor.getByRole('button', { name: 'Annotate', exact: true }).click()
  const tool = editor.getByRole('button', { name: 'Text box', exact: true })
  if (!(await tool.getAttribute('class'))?.split(' ').includes('active')) await tool.click()
  const layer = editor.locator('.pdf-page .pdf-draw-layer').first()
  const box = await layer.boundingBox()
  if (!box) throw new Error('Missing draw layer')
  await editor.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3)
  const input = editor.getByRole('textbox', { name: 'Text box' })
  await expect(input).toBeFocused()
  await input.fill(text)
  await input.press('ControlOrMeta+Enter')
  await expect(input).toHaveCount(0)
}

async function insertBlankPage(editor: Page): Promise<void> {
  await editor.getByRole('button', { name: 'Pages', exact: true }).click()
  await editor.getByRole('button', { name: 'Insert blank page', exact: true }).click()
}

test('a page tool asks before saving unsaved edits into a never-saved PDF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-flush-confirm-'))
  const source = join(dir, 'report.pdf')
  const original = await onePagePdf()
  await writeFile(source, original)
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-flush-confirm',
    openFile: source,
  })
  try {
    await stubMessageBoxes(launched.app)
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await addTextBox(editor, 'Draft note')

    // Cancel: nothing is written, the edit stays pending, no page is added
    await answerNext(launched.app, 'Cancel')
    await insertBlankPage(editor)
    await expect.poll(() => shownBoxes(launched.app)).toEqual([FLUSH_MSG])
    await expect(editor.getByText('Unsaved', { exact: true })).toBeVisible()
    expect(Buffer.compare(await readFile(source), Buffer.from(original))).toBe(0)

    // Save and Continue: the edit is saved into the file, then the page is inserted
    await answerNext(launched.app, 'Save and Continue')
    await insertBlankPage(editor)
    await expect.poll(() => pageCount(source)).toBe(2)
    expect(await freeTexts(source)).toEqual(['Draft note'])
    expect(await shownBoxes(launched.app)).toEqual([FLUSH_MSG, FLUSH_MSG])

    // Once saved, the file is the user's working copy: later tools no longer ask
    await addTextBox(editor, 'Second note')
    await insertBlankPage(editor)
    await expect.poll(() => pageCount(source)).toBe(3)
    expect(await shownBoxes(launched.app)).toEqual([FLUSH_MSG, FLUSH_MSG])
  } finally {
    await closeAndSaveVideo(launched, 'pdf-flush-confirm')
    await rm(dir, { recursive: true, force: true })
  }
})
