import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

/** One page with an email address and a saved rectangle comment by "Reviewer" */
async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([300, 200])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Contact jane@example.com today', { x: 20, y: 150, size: 12, font })
  page.drawText('PUBLIC', { x: 20, y: 40, size: 12, font })
  const square = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [150, 30, 260, 90],
    C: [1, 0, 0],
    T: PDFString.of('Reviewer'),
    Contents: PDFString.of('Check this box'),
  })
  page.node.addAnnot(pdf.context.register(square))
  return pdf.save()
}

async function annotSubtypes(path: string): Promise<string[]> {
  const pdf = await PDFDocument.load(await readFile(path))
  const annots = pdf.getPage(0).node.Annots()?.asArray() ?? []
  return annots.map((ref) => String(pdf.context.lookup(ref, PDFDict).get(PDFName.of('Subtype'))))
}

test('find and redact marks emails; the comments list deletes a saved shape', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-find-redact-'))
  const source = join(dir, 'sample.pdf')
  const redacted = join(dir, 'redacted.pdf')
  await writeFile(source, await samplePdf())
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-find-redact-comments',
    openFile: source,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()

    // Find & redact: the email pattern marks exactly the address
    await editor.getByRole('tab', { name: 'Annotate', exact: true }).click()
    await editor.getByRole('button', { name: 'Find & redact', exact: true }).click()
    await editor.getByRole('combobox', { name: 'What to find' }).selectOption('email')
    await expect(editor.locator('.pdf-search-count')).toHaveText('1 / 1')
    await editor.getByRole('button', { name: 'Mark all', exact: true }).click()
    await expect(editor.locator('.pdf-redaction-mark')).toHaveCount(1)
    // Running it again adds nothing; one mark can be removed on its own
    await editor.getByRole('button', { name: 'Mark all', exact: true }).click()
    await expect(editor.locator('.pdf-redaction-mark')).toHaveCount(1)
    await editor.getByRole('button', { name: 'Redact area', exact: true }).click()
    await editor.getByRole('button', { name: 'Remove this mark' }).click()
    await expect(editor.locator('.pdf-redaction-mark')).toHaveCount(0)
    await editor.getByRole('button', { name: 'Redact area', exact: true }).click()

    // Comments list shows the saved rectangle with its author and text
    await editor.getByRole('tab', { name: 'View', exact: true }).click()
    await editor.getByRole('button', { name: 'Comments', exact: true }).click()
    const row = editor.locator('.pdf-comment-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Rectangle')
    await expect(row).toContainText('Reviewer')
    await expect(row).toContainText('Check this box')
    await row.hover()
    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(row).toHaveCount(0)
    await expect(editor.locator('.pdf-comments-empty')).toHaveText('No comments in this PDF')

    expect(await annotSubtypes(source)).toEqual(['/Square'])
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => annotSubtypes(source)).toEqual([])
    // The file lands before the editor reloads it; applying waits for a settled save
    await expect(editor.getByText('Unsaved', { exact: true })).toHaveCount(0)

    // Applying the email marks removes every glyph of the address and nothing around it
    await editor.getByRole('tab', { name: 'Annotate', exact: true }).click()
    await editor.getByRole('button', { name: 'Mark all', exact: true }).click()
    await expect(editor.locator('.pdf-redaction-mark')).toHaveCount(1)
    await launched.app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, redacted)
    editor.on('dialog', (dialog) => dialog.accept())
    await editor.getByRole('button', { name: 'Apply redactions', exact: true }).click()
    await expect(editor.locator('.pdf-redaction-mark')).toHaveCount(0)
    const layer = editor.locator('.textLayer').first()
    await expect(layer).toContainText('Contact')
    await expect(layer).toContainText('today')
    await expect(layer).not.toContainText('@')
    await expect(layer).not.toContainText('jane')
    await expect(layer).not.toContainText('.com')
  } finally {
    await closeAndSaveVideo(launched, 'pdf-find-redact-comments')
    await rm(dir, { recursive: true, force: true })
  }
})
