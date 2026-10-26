import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

async function fieldSummary(path: string): Promise<string[]> {
  const form = (await PDFDocument.load(await readFile(path))).getForm()
  return form
    .getFields()
    .map((f) => `${f.constructor.name}:${f.getName()}`)
    .sort()
}

test('form fields are placed on the page, named, saved and then fillable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-form-designer-'))
  const source = join(dir, 'blank.pdf')
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 400])
  await writeFile(source, await pdf.save())
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-form-designer',
    openFile: source,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await editor.getByRole('tab', { name: 'Prepare form', exact: true }).click()

    const layer = editor.locator('.pdf-page .pdf-draw-layer').first()
    const box = await layer.boundingBox()
    if (!box) throw new Error('Missing draw layer')
    const at = (fx: number, fy: number) =>
      editor.mouse.click(box.x + box.width * fx, box.y + box.height * fy)

    await editor.getByRole('button', { name: 'Text field', exact: true }).click()
    await at(0.1, 0.1)
    await expect(layer.locator('.pdf-field-draft-label')).toHaveText(['Text1'])

    // Two radio buttons in a row form one group
    await editor.getByRole('button', { name: 'Radio button', exact: true }).click()
    await at(0.1, 0.3)
    await at(0.3, 0.3)
    await expect(layer.locator('.pdf-field-draft-label')).toHaveText([
      'Text1',
      'Group1: Choice1',
      'Group1: Choice2',
    ])

    // A dropdown asks for its options right away
    await editor.getByRole('button', { name: 'Dropdown', exact: true }).click()
    await at(0.1, 0.5)
    const dialog = editor.getByRole('dialog', { name: 'Field properties' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Text1')
    await expect(dialog.getByText('Another field already uses this name.')).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Name' }).fill('City')
    await dialog.getByRole('textbox', { name: 'Options' }).fill('Cairo\nAlexandria')
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await editor.keyboard.press('ControlOrMeta+s')
    await expect
      .poll(() => fieldSummary(source))
      .toEqual(['PDFDropdown:City', 'PDFRadioGroup:Group1', 'PDFTextField:Text1'])
    await expect(editor.getByText('Unsaved', { exact: true })).toHaveCount(0)

    // After the reload the new fields are live form controls
    await expect(editor.locator('.pdf-form-layer .pdf-form-radio')).toHaveCount(2)
    await expect(editor.locator('.pdf-form-layer .pdf-form-select')).toHaveCount(1)
    const input = editor.locator('.pdf-form-layer .pdf-form-input')
    await input.fill('Omar')
    await editor.keyboard.press('ControlOrMeta+s')
    await expect
      .poll(async () =>
        (await PDFDocument.load(await readFile(source))).getForm().getTextField('Text1').getText(),
      )
      .toBe('Omar')
  } finally {
    await closeAndSaveVideo(launched, 'pdf-form-designer')
    await rm(dir, { recursive: true, force: true })
  }
})
