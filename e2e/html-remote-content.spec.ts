/**
 * Opening an HTML file must not reach the network: the preview blocks web content (a
 * tracking pixel would otherwise tell the sender the file was opened) until the user
 * clicks "Load web content" for that tab. Local pictures beside the file still load.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication } from '@playwright/test'
import { PNG } from 'pngjs'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

// .invalid never resolves, and the hook below cancels every request anyway
const REMOTE = [
  'https://fonts.example.invalid/css2?family=Roboto',
  'https://cdn.example.invalid/tracker.js',
  'https://images.example.invalid/logo.png',
  'https://tracker.example.invalid/pixel.gif?doc=letter123',
]

const PAGE = `<!doctype html>
<html>
<head>
<link rel="stylesheet" href="${REMOTE[0]}">
<script src="${REMOTE[1]}"></script>
</head>
<body>
<h1>Letter</h1>
<img id="remote" src="${REMOTE[2]}">
<img id="pixel" src="${REMOTE[3]}" width="1" height="1">
<img id="local" src="local.png">
</body>
</html>
`

/** Record (and cancel) every http(s) request the app makes from now on */
async function recordRemoteRequests(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session }) => {
    const g = globalThis as unknown as { __remote: string[] }
    g.__remote = []
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (
        /^https?:/i.test(details.url) &&
        !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(details.url)
      ) {
        g.__remote.push(details.url)
        callback({ cancel: true })
      } else callback({})
    })
  })
}

const remoteRequests = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __remote: string[] }).__remote)

test('an HTML file loads no web content until the user asks for it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-html-remote-'))
  const htmlPath = join(dir, 'letter.html')
  await writeFile(htmlPath, PAGE)
  const png = new PNG({ width: 4, height: 4 })
  png.data.fill(200)
  await writeFile(join(dir, 'local.png'), PNG.sync.write(png))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'html-remote-content',
    openFile: htmlPath,
  })
  const { app } = launched
  try {
    let editor = await waitForPageWithUrl(app, '://html/')
    await expect(editor.locator('.preview-frame')).toBeVisible()
    // The hook can only be installed once the app runs: reload the editor so its first
    // preview load happens under it
    await recordRemoteRequests(app)
    await editor.reload()
    editor = await waitForPageWithUrl(app, '://html/')
    const frame = editor.frameLocator('.preview-frame')
    await expect(frame.locator('h1')).toHaveText('Letter')

    const bar = editor.locator('.remote-bar')
    await expect(bar).toContainText('blocked in this preview')
    // the local picture beside the file still loads
    await expect
      .poll(() => frame.locator('#local').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(4)
    await editor.waitForTimeout(1000)
    expect(await remoteRequests(app)).toEqual([])

    // One click loads it, for this tab
    await bar.getByRole('button', { name: 'Load web content' }).click()
    await expect(bar).toHaveCount(0)
    await expect.poll(async () => new Set(await remoteRequests(app))).toEqual(new Set(REMOTE))
  } finally {
    await closeAndSaveVideo(launched, 'html-remote-content')
    await rm(dir, { recursive: true, force: true })
  }
})

const FRAMED_PAGE = `<!doctype html>
<html>
<body>
<h1>Report</h1>
<img src="https://images.example.invalid/header.png">
<object id="chart" data="chart.svg" type="image/svg+xml" width="40" height="40"></object>
<a id="news" href="https://news.example.invalid/story" target="_blank">News</a>
<a id="docs" href="https://docs.example.invalid/guide">Guide</a>
<script>
window.__popup = String(window.open('https://popup.example.invalid/'))
window.__rtc = typeof RTCPeerConnection
</script>
</body>
</html>
`

// A chart drawn by a local SVG file, pulling a picture from the web: a framed document
// does not inherit the page's content policy
const CHART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">
<image href="https://images.example.invalid/chart-logo.png" width="40" height="40"/>
</svg>
`

/** Record the addresses the app hands to the system browser, without opening them */
async function recordExternalOpens(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] }
    g.__opened = []
    shell.openExternal = async (url: string) => {
      g.__opened.push(url)
    }
  })
}

const externalOpens = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)

test('while web content is blocked, framed files, popups and WebRTC stay offline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hyperfiles-html-framed-'))
  const htmlPath = join(dir, 'report.html')
  await writeFile(htmlPath, FRAMED_PAGE)
  await writeFile(join(dir, 'chart.svg'), CHART_SVG)

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'html-remote-content-framed',
    openFile: htmlPath,
  })
  const { app } = launched
  try {
    let editor = await waitForPageWithUrl(app, '://html/')
    await expect(editor.locator('.preview-frame')).toBeVisible()
    await recordRemoteRequests(app)
    await recordExternalOpens(app)
    await editor.reload()
    editor = await waitForPageWithUrl(app, '://html/')
    const frame = editor.frameLocator('.preview-frame')
    await expect(frame.locator('h1')).toHaveText('Report')
    const body = frame.locator('body')

    // the page's script could neither open a window nor reach for WebRTC
    expect(await body.evaluate(() => (window as unknown as { __popup: string }).__popup)).toBe(
      'null',
    )
    expect(await body.evaluate(() => (window as unknown as { __rtc: string }).__rtc)).toBe(
      'undefined',
    )
    // neither the page's web picture nor the framed chart's is fetched
    await expect(editor.locator('.remote-bar')).toContainText('blocked in this preview')
    await editor.waitForTimeout(1000)
    expect(await remoteRequests(app)).toEqual([])

    // A message the document's script forges, without a click, opens nothing (the script
    // can read the inspector's version stamp, so the message passes for genuine). Playwright's
    // own calls into a page count as a click for a few seconds: let that run out, then run
    // the forgery from the main process, which does not
    await editor.waitForTimeout(5500)
    const forged = await app.evaluate(async ({ webContents }) => {
      for (const wc of webContents.getAllWebContents()) {
        const preview = wc.mainFrame.framesInSubtree.find((f) => f.url.startsWith('html-preview:'))
        if (!preview) continue
        return preview.executeJavaScript(
          `(() => {
            const sources = [...document.querySelectorAll('script[data-gx-inspector]')]
            const stamp = /const VERSION = Number\\('(\\d+)'\\)/.exec(
              sources.map((el) => el.textContent).join('\\n'),
            )
            if (!stamp) return false
            window.parent.postMessage(
              { type: 'gx:navigateBlocked', href: 'https://forged.example.invalid/', version: Number(stamp[1]) },
              '*',
            )
            return true
          })()`,
          false,
        )
      }
      return false
    })
    expect(forged).toBe(true)
    await editor.waitForTimeout(500)
    expect(await externalOpens(app)).toEqual([])

    // web links still open in the browser when clicked: Ctrl+click while editing, a plain
    // click while presenting (the frame may not open windows itself)
    await frame.locator('#news').click({ modifiers: ['ControlOrMeta'] })
    await expect.poll(() => externalOpens(app)).toEqual(['https://news.example.invalid/story'])
    await editor
      .locator('.ribbon-body')
      .getByRole('button', { name: /Present/ })
      .click()
    await editor
      .locator('.rb-menu')
      .getByRole('menuitem', { name: /In this tab/ })
      .click()
    await expect(editor.locator('.present-exit')).toBeVisible()
    await frame.locator('#docs').click()
    await frame.locator('#news').click()
    await expect
      .poll(() => externalOpens(app))
      .toEqual([
        'https://news.example.invalid/story',
        'https://docs.example.invalid/guide',
        'https://news.example.invalid/story',
      ])
    await expect(frame.locator('h1')).toHaveText('Report')
    expect(await remoteRequests(app)).toEqual([])
    await editor.locator('.present-exit').click()

    // Load web content covers the framed chart too
    await editor.locator('.remote-bar').getByRole('button', { name: 'Load web content' }).click()
    await expect
      .poll(() => remoteRequests(app))
      .toContain('https://images.example.invalid/chart-logo.png')
  } finally {
    await closeAndSaveVideo(launched, 'html-remote-content-framed')
    await rm(dir, { recursive: true, force: true })
  }
})
