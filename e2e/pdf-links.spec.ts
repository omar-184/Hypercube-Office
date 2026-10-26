import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

async function linkTargets(path: string): Promise<string[]> {
  const pdf = await PDFDocument.load(await readFile(path))
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return []
  return Array.from({ length: annots.size() }, (_, i) => annots.lookup(i, PDFDict))
    .filter((a) => a.lookup(PDFName.of('Subtype'), PDFName).decodeText() === 'Link')
    .map((a) => {
      const action = a.lookupMaybe(PDFName.of('A'), PDFDict)
      return action ? action.lookup(PDFName.of('URI'), PDFString).decodeText() : 'page'
    })
}

test('a link is drawn, pointed at a web address, saved and then removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-links-'))
  const source = join(dir, 'doc.pdf')
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 300])
  pdf.addPage([400, 300])
  await writeFile(source, await pdf.save())
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-links',
    openFile: source,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await editor.getByRole('tab', { name: 'Edit', exact: true }).click()
    await editor.getByRole('button', { name: 'Link', exact: true }).click()

    const layer = editor.locator('.pdf-page .pdf-draw-layer').first()
    const box = await layer.boundingBox()
    if (!box) throw new Error('Missing draw layer')
    await editor.mouse.move(box.x + 40, box.y + 40)
    await editor.mouse.down()
    await editor.mouse.move(box.x + 200, box.y + 70, { steps: 5 })
    await editor.mouse.up()

    const dialog = editor.getByRole('dialog', { name: 'Link' })
    const url = dialog.getByRole('textbox', { name: 'Web address' })
    await expect(url).toBeFocused()
    await url.fill('javascript:alert(1)')
    await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeDisabled()
    await url.fill('example.com')
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    await expect(layer.locator('.pdf-link-draft')).toHaveCount(1)

    // A second link to page 2
    await editor.mouse.move(box.x + 40, box.y + 120)
    await editor.mouse.down()
    await editor.mouse.move(box.x + 200, box.y + 150, { steps: 5 })
    await editor.mouse.up()
    await dialog.getByRole('radio', { name: 'Page in this document' }).check()
    await dialog.getByRole('spinbutton', { name: 'Page in this document' }).fill('2')
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()

    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => linkTargets(source)).toEqual(['https://example.com/', 'page'])
    await expect(editor.getByText('Unsaved', { exact: true })).toHaveCount(0)

    // With the link tool on, saved links can be removed
    const remove = editor.locator('.pdf-page').first().getByRole('button', { name: 'Remove link' })
    await expect(remove).toHaveCount(2)
    await remove.first().click()
    await expect(remove).toHaveCount(1)
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => linkTargets(source)).toHaveLength(1)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-links')
    await rm(dir, { recursive: true, force: true })
  }
})
