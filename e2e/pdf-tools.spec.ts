import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

/**
 * A one-page PDF reading `label`. The cross-reference table is left out on
 * purpose: MuPDF rebuilds it, which also exercises the repair path.
 */
function tinyPdf(label: string): string {
  const content = `BT /F1 24 Tf 72 720 Td (${label}) Tj ET`
  return [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R',
    '  /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${content.length} >> stream`,
    content,
    'endstream endobj',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n')
}

/**
 * `pages` pages that each take a moment to render at print resolution: every
 * page shares one content stream of a few hundred filled curves.
 */
function densePdf(pages: number): string {
  const ops: string[] = []
  for (let k = 0; k < 400; k++) {
    const x = (k * 37) % 560
    const y = (k * 53) % 760
    ops.push(
      `${(k % 7) / 7} ${(k % 5) / 5} ${(k % 3) / 3} rg ${x} ${y} m ${x + 40} ${y + 30} ${x + 10} ${y + 60} ${x + 50} ${y + 5} c f`,
    )
  }
  const content = ops.join('\n')
  const kids = Array.from({ length: pages }, (_, i) => `${i + 4} 0 R`).join(' ')
  return [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages} >> endobj`,
    `3 0 obj << /Length ${content.length} >> stream`,
    content,
    'endstream endobj',
    ...Array.from(
      { length: pages },
      (_, i) =>
        `${i + 4} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 3 0 R >> endobj`,
    ),
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n')
}

/** Every path under `dir`, relative to it. */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
}

/** Page objects in a file MuPDF wrote without object streams. */
function countPages(pdf: string): number {
  return (pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
}

test.describe('PDF tools', () => {
  test('lists the tools and merges two files into one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdf-tools-e2e-'))
    const a = join(dir, 'first.pdf')
    const b = join(dir, 'second.pdf')
    await writeFile(a, tinyPdf('First'))
    await writeFile(b, tinyPdf('Second'))

    const launched = await launchShell({ onboardingSeen: true, videoDir: 'pdf-tools-merge' })
    const { app, page } = launched
    try {
      await page.locator('.nav-item', { hasText: 'PDF Tools' }).click()
      await expect(page.locator('.pt-card')).toHaveCount(18)
      await page.screenshot({ path: screenshotPath('pdf-tools-grid') })

      // the native file picker cannot be driven; answer it from the main process
      await app.evaluate(
        ({ dialog }, paths) => {
          dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths: paths,
          })) as typeof dialog.showOpenDialog
        },
        [a, b],
      )

      await page.locator('.pt-card', { hasText: 'Merge PDF' }).click()
      await page.getByRole('button', { name: 'Choose PDF files' }).click()
      await expect(page.locator('.pt-file')).toHaveCount(2)
      await expect(page.locator('.pt-file').first()).toContainText('1 page')
      await expect(page.locator('.pt-file').nth(1)).toContainText('1 page')
      await page.screenshot({ path: screenshotPath('pdf-tools-merge-files') })

      await page.locator('.pt-start').click()
      await expect(page.locator('.pt-results-title')).toHaveText('Done')
      await page.screenshot({ path: screenshotPath('pdf-tools-merge-done') })

      expect((await readdir(dir)).sort()).toEqual(['first-merged.pdf', 'first.pdf', 'second.pdf'])
      const merged = await readFile(join(dir, 'first-merged.pdf'), 'latin1')
      expect(countPages(merged)).toBe(2)
    } finally {
      await closeAndSaveVideo(launched, 'pdf-tools-merge')
    }
  })

  test('a long run shows its progress, survives another view, and can be canceled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdf-tools-cancel-e2e-'))
    const inputs = ['alpha.pdf', 'bravo.pdf', 'charlie.pdf']
    for (const name of inputs) await writeFile(join(dir, name), densePdf(60))

    const launched = await launchShell({ onboardingSeen: true, videoDir: 'pdf-tools-cancel' })
    const { app, page } = launched
    try {
      await app.evaluate(
        ({ dialog }, paths) => {
          dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths: paths,
          })) as typeof dialog.showOpenDialog
        },
        inputs.map((n) => join(dir, n)),
      )
      await page.locator('.nav-item', { hasText: 'PDF Tools' }).click()
      await page.locator('.pt-card', { hasText: 'PDF to images' }).click()
      await page.getByRole('button', { name: 'Choose PDF files' }).click()
      await expect(page.locator('.pt-file.ready')).toHaveCount(3)
      await page.getByRole('radio', { name: '300 dpi · print' }).click()
      await page.locator('.pt-start').click()

      const bar = page.getByRole('progressbar')
      await expect(bar).toHaveAttribute('aria-valuenow', '0')
      await expect(page.locator('.pt-progress-label')).toHaveText('File 1 of 3')
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
      await expect(page.locator('.pt-file-meta')).toHaveText(['Working…', 'Waiting', 'Waiting'])

      // another view and back: the run keeps going and the nav item says so
      await page.locator('.nav-item', { hasText: 'Recent' }).click()
      await expect(page.locator('.nav-badge.busy')).toHaveAttribute('aria-label', 'Working')
      await page.locator('.nav-item', { hasText: 'PDF Tools' }).click()
      await expect(bar).toBeVisible()
      await page.screenshot({ path: screenshotPath('pdf-tools-running') })

      await page.getByRole('button', { name: 'Cancel' }).click()
      const title = page.locator('.pt-results-title')
      await expect(title).toHaveText('Canceled')
      await expect(title).toBeFocused()
      await expect(page.locator('.nav-badge')).toHaveCount(0)
      await page.screenshot({ path: screenshotPath('pdf-tools-canceled') })

      // what the summary counts is exactly what is on disk, with nothing half-written
      const note = (await page.locator('.pt-results-note').textContent()) ?? ''
      const done = Number(/after (\d) of 3/.exec(note)?.[1] ?? 0)
      expect(done < 3).toBe(true)
      if (done === 0) expect(note).toBe('Stopped before anything was saved.')
      const outputs = (await walk(dir)).filter((p) => !inputs.includes(p))
      expect(new Set(outputs.map((p) => p.split(/[\\/]/)[0])).size).toBe(done)
      expect(outputs.filter((p) => p.endsWith('.part'))).toEqual([])
      await expect(page.locator('.pt-results .pt-file')).toHaveCount(done)
    } finally {
      await closeAndSaveVideo(launched, 'pdf-tools-cancel')
      await rm(dir, { recursive: true, force: true })
    }
  })
})
