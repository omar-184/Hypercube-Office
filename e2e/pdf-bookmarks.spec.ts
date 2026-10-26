import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo } from './helpers'

interface Node {
  title: string
  items: Node[]
}

async function bookmarks(path: string): Promise<unknown> {
  const task = getDocument({ data: new Uint8Array(await readFile(path)) })
  const doc = await task.promise
  const walk = (nodes: Node[]): unknown =>
    nodes.map((n) => (n.items.length ? [n.title, walk(n.items)] : n.title))
  const outline = ((await doc.getOutline()) ?? []) as Node[]
  await task.destroy()
  return walk(outline)
}

test('bookmarks are added, renamed, nested, reordered and saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-bookmarks-'))
  const source = join(dir, 'pages.pdf')
  const pdf = await PDFDocument.create()
  for (let i = 0; i < 3; i++) pdf.addPage([300, 400])
  await writeFile(source, await pdf.save())
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-bookmarks',
    openFile: source,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(editor.locator('.pdf-page').first()).toBeVisible()
    await editor.getByRole('tab', { name: 'View', exact: true }).click()
    await editor.getByRole('button', { name: 'Outline', exact: true }).click()

    const add = editor.getByRole('button', { name: 'Add bookmark for the current page' })
    const rename = editor.locator('.pdf-outline-rename')
    const addNamed = async (title: string) => {
      await add.click()
      await expect(rename).toBeFocused()
      await rename.fill(title)
      await rename.press('Enter')
      await expect(rename).toHaveCount(0)
    }
    await addNamed('Intro')
    await addNamed('Details')
    await addNamed('Chapter')
    const items = editor.locator('.pdf-outline-item')
    await expect(items).toHaveText(['Intro', 'Details', 'Chapter'])

    // "Details" moves below "Chapter" and becomes its child
    await items.filter({ hasText: 'Details' }).click()
    await editor.getByRole('button', { name: 'Move down' }).click()
    await editor.getByRole('button', { name: 'Make it a child of the bookmark above' }).click()
    await expect(items).toHaveText(['Intro', 'Chapter', 'Details'])

    // Double-click renames in place
    await items.filter({ hasText: 'Intro' }).dblclick()
    await rename.fill('Overview')
    await rename.press('Enter')

    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => bookmarks(source)).toEqual(['Overview', ['Chapter', ['Details']]])
    await expect(editor.getByText('Unsaved', { exact: true })).toHaveCount(0)

    // After the reload the saved tree is shown and still editable
    await expect(items).toHaveText(['Overview', 'Chapter', 'Details'])
    await items.filter({ hasText: 'Overview' }).click()
    await editor.getByRole('button', { name: 'Delete bookmark' }).click()
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => bookmarks(source)).toEqual([['Chapter', ['Details']]])
  } finally {
    await closeAndSaveVideo(launched, 'pdf-bookmarks')
    await rm(dir, { recursive: true, force: true })
  }
})
