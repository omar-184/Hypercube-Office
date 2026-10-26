import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

async function freeTexts(path: string): Promise<string[]> {
  const pdf = await PDFDocument.load(await readFile(path))
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return []
  return Array.from({ length: annots.size() }, (_, i) => annots.lookup(i, PDFDict))
    .filter((a) => a.lookup(PDFName.of('Subtype'), PDFName).decodeText() === 'FreeText')
    .map((a) => (a.lookup(PDFName.of('Contents')) as { decodeText(): string }).decodeText())
}

test('a text-box comment is typed on the page, edited, saved and listed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-text-box-'))
  const source = join(dir, 'sample.pdf')
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 300])
  await writeFile(source, await pdf.save())
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-text-box',
    openFile: source,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await editor.getByRole('button', { name: 'Annotate', exact: true }).click()
    await editor.getByRole('button', { name: 'Text box', exact: true }).click()

    const layer = editor.locator('.pdf-page .pdf-draw-layer').first()
    const box = await layer.boundingBox()
    if (!box) throw new Error('Missing draw layer')
    await editor.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2)
    const input = editor.getByRole('textbox', { name: 'Text box' })
    await expect(input).toBeFocused()
    await input.fill('Check the total')
    await input.press('ControlOrMeta+Enter')
    await expect(input).toHaveCount(0)
    await expect(layer.locator('text')).toHaveText('Check the total')

    // Double-click reopens the editor with the text
    await editor.getByRole('button', { name: 'Text box', exact: true }).click()
    await layer.locator('text').dblclick()
    await expect(input).toHaveValue('Check the total')
    await input.fill('Check the grand total')
    await input.press('ControlOrMeta+Enter')
    await expect(layer.locator('text')).toHaveText('Check the grand total')

    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => freeTexts(source)).toEqual(['Check the grand total'])

    // After the reload it is a saved annotation: listed with its text. Until the reload
    // finishes the list can briefly show the saved copy beside the pending "Unsaved" one.
    await editor.getByRole('button', { name: 'View', exact: true }).click()
    await editor.getByRole('button', { name: 'Comments', exact: true }).click()
    await expect(editor.locator('.pdf-comment-unsaved')).toHaveCount(0)
    const row = editor.locator('.pdf-comment-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Text box')
    await expect(row).toContainText('Check the grand total')
  } finally {
    await closeAndSaveVideo(launched, 'pdf-text-box')
    await rm(dir, { recursive: true, force: true })
  }
})

test('a text box added right after a save is written once, beside the saved one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-text-box-twice-'))
  const source = join(dir, 'sample.pdf')
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 300])
  await writeFile(source, await pdf.save())
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-text-box-twice',
    openFile: source,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await editor.getByRole('button', { name: 'Annotate', exact: true }).click()
    // The tool stays armed after each box
    await editor.getByRole('button', { name: 'Text box', exact: true }).click()
    const layer = editor.locator('.pdf-page .pdf-draw-layer').first()
    const box = await layer.boundingBox()
    if (!box) throw new Error('Missing draw layer')
    const input = editor.getByRole('textbox', { name: 'Text box' })
    const addBox = async (text: string, at: number) => {
      await editor.mouse.click(box.x + box.width * at, box.y + box.height * at)
      await expect(input).toBeFocused()
      await input.fill(text)
      await input.press('ControlOrMeta+Enter')
      await expect(input).toHaveCount(0)
    }

    await addBox('First note', 0.2)
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => freeTexts(source), { intervals: [20] }).toEqual(['First note'])
    // Add and save again while the first save's reload is still settling: the second save
    // queues behind it and must not write the first box again
    await addBox('Second note', 0.6)
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => freeTexts(source)).toContain('Second note')
    await editor.getByRole('button', { name: 'View', exact: true }).click()
    await editor.getByRole('button', { name: 'Comments', exact: true }).click()
    await expect(editor.locator('.pdf-comment-unsaved')).toHaveCount(0)
    expect(await freeTexts(source)).toEqual(['First note', 'Second note'])
  } finally {
    await closeAndSaveVideo(launched, 'pdf-text-box-twice')
    await rm(dir, { recursive: true, force: true })
  }
})

test('a save pressed as the previous save lands waits for its reload instead of writing the box again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-text-box-landing-'))
  const source = join(dir, 'sample.pdf')
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 300])
  await writeFile(source, await pdf.save())
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-text-box-landing',
    openFile: source,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await editor.getByRole('button', { name: 'Annotate', exact: true }).click()
    await editor.getByRole('button', { name: 'Text box', exact: true }).click()
    const layer = editor.locator('.pdf-page .pdf-draw-layer').first()
    const box = await layer.boundingBox()
    if (!box) throw new Error('Missing draw layer')
    const input = editor.getByRole('textbox', { name: 'Text box' })
    const addBox = async (text: string, at: number) => {
      await editor.mouse.click(box.x + box.width * at, box.y + box.height * at)
      await expect(input).toBeFocused()
      await input.fill(text)
      await input.press('ControlOrMeta+Enter')
      await expect(input).toHaveCount(0)
    }

    await addBox('First note', 0.2)
    // Press Save again the moment the first save's reload reaches the screen. The commit
    // that takes "Saving…" down carries the reload, and observers run before React re-binds
    // the keyboard handler to it, so this keypress reaches the handler that still lists the
    // first box as pending — what a real keypress queued behind that commit does.
    await editor.evaluate(() => {
      const w = window as unknown as { __pressedOnLanding?: boolean }
      let saving = false
      const observer = new MutationObserver(() => {
        const badges = [...document.querySelectorAll('.tb-save-pending')]
        if (badges.some((el) => el.textContent === 'Saving…')) saving = true
        else if (saving) {
          observer.disconnect()
          w.__pressedOnLanding = true
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    await editor.keyboard.press('ControlOrMeta+s')
    await expect
      .poll(() =>
        editor.evaluate(
          () => (window as unknown as { __pressedOnLanding?: boolean }).__pressedOnLanding,
        ),
      )
      .toBe(true)

    // The second box's save queues behind any write that keypress started, so once it is in
    // the file the first box has been written as often as it ever will be
    await addBox('Second note', 0.6)
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => freeTexts(source)).toContain('Second note')
    expect(await freeTexts(source)).toEqual(['First note', 'Second note'])
  } finally {
    await closeAndSaveVideo(launched, 'pdf-text-box-landing')
    await rm(dir, { recursive: true, force: true })
  }
})
