/**
 * Mock Even Hub host for end-to-end checks of a built Noor bundle (dist/).
 *
 * Serves the build on localhost, opens it in Chromium (Playwright must be
 * available — it is not a project dependency), stands in for the Even app via
 * window.flutter_inappwebview, records every image tile the app sends and lets
 * tests inject SDK events exactly as the host does.
 *
 * This verifies software behaviour only; it is not a substitute for testing
 * on physical G2 glasses.
 */
const http = require('http'), fs = require('fs'), path = require('path')
const { chromium } = require('playwright')

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png' }

function serve(dir) {
  return new Promise(resolve => {
    const srv = http.createServer((q, r) => {
      let p = path.join(dir, decodeURIComponent(q.url.split('?')[0]))
      if (p.endsWith('/')) p += 'index.html'
      fs.readFile(p, (e, d) => {
        if (e) { r.writeHead(404); r.end(); return }
        r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(d)
      })
    }).listen(0, '127.0.0.1', () => resolve(srv))
  })
}

/**
 * bridge: { store: {key: value}, mode: 'ok' | 'fail' | 'empty', delayMs: number | () => number }
 * The store lives in Node, so it survives page reloads and can be shared with a
 * new browser (simulating lost WebView storage). Mutate `mode`/`delayMs` between steps.
 */
async function openApp(distDir, { logs = false, offline = false, bridge = { store: {}, mode: 'ok', delayMs: 0 } } = {}) {
  const srv = await serve(distDir)
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const consoleLines = []
  const blocked = []
  if (offline) {
    // Simulate no internet: only the local app server is reachable
    await page.route('**/*', route => {
      const u = route.request().url()
      if (u.startsWith('http://127.0.0.1:')) return route.continue()
      blocked.push(u); return route.abort('internetdisconnected')
    })
  }
  page.on('console', m => { consoleLines.push(m.text()); if (logs) console.log('  [app]', m.text().slice(0, 200)) })
  // Bridge storage (setLocalStorage / getLocalStorage), backed by bridge.store in Node
  await page.exposeBinding('__bridgeSet', async (_src, key, value) => {
    const d = typeof bridge.delayMs === 'function' ? bridge.delayMs() : (bridge.delayMs || 0)
    if (d) await new Promise(r => setTimeout(r, d))
    if (bridge.mode === 'fail') return false
    bridge.store[key] = value
    if (bridge.log) bridge.log.push([key, value])
    return true
  })
  await page.exposeBinding('__bridgeGet', async (_src, key) =>
    bridge.mode === 'ok' && Object.prototype.hasOwnProperty.call(bridge.store, key) ? bridge.store[key] : '')
  await page.addInitScript(() => {
    window.__tiles = {}; window.__sends = 0; window.__calls = []
    window.flutter_inappwebview = {
      callHandler: (_name, payload) => {
        try {
          const msg = JSON.parse(payload)
          window.__calls.push(msg.method)
          if (msg.method === 'updateImageRawData') {
            window.__tiles[msg.data.containerID] = msg.data.imageData
            window.__sends++
          }
          if (msg.method === 'setLocalStorage') return window.__bridgeSet(msg.data.key, msg.data.value)
          if (msg.method === 'getLocalStorage') return window.__bridgeGet(msg.data.key)
        } catch (_) {}
        return Promise.resolve(0)
      },
    }
  })
  const ready = async () => {
    await page.waitForFunction(() => window.__sends >= 4 && window.noor, null, { timeout: 15000 })
    await page.waitForTimeout(2300)   // let the app's start-up re-renders (0.9 s, 2 s) finish
  }
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`)
  await ready()

  const app = {
    page, consoleLines, blocked, bridge,
    /** Close and reopen the app (WebView reload): localStorage and bridge storage survive. */
    async reload() { await page.reload(); await ready() },
    /** Wait for the app to finish starting after a reload it triggered itself. */
    waitReady: ready,
    /** Wait until no tile has been sent for `quietMs`, then return the 4 tiles as Buffers. */
    async settle(quietMs = 120) {
      let last = -1
      for (;;) {
        const n = await page.evaluate(() => window.__sends)
        if (n === last) break
        last = n; await page.waitForTimeout(quietMs)
      }
      const t = await page.evaluate(() => window.__tiles)
      return [1, 2, 3, 4].map(i => Buffer.from(t[i]))
    },
    /** Run fn in the page, wait for a full 4-tile render to finish, return the tiles. */
    async render(fn, arg) {
      const base = await page.evaluate(() => window.__sends)
      await page.evaluate(fn, arg)
      await page.waitForFunction(b => window.__sends >= b + 4, base, { timeout: 10000 })
      return app.settle(40)
    },
    /** Inject an SDK event the way the host does (sysEvent). Click omits eventType like the G2. */
    async event(type, source = 1) {
      const json = type === 0 ? { eventSource: source } : { eventType: type, eventSource: source }
      await page.evaluate(j => window._listenEvenAppMessage(
        { type: 'listen_even_app_data', method: 'evenHubEvent', data: { type: 'sysEvent', jsonData: j } }), json)
    },
    eval: (fn, arg) => page.evaluate(fn, arg),
    /** Compose the last 4 tiles into one 576×288 PNG (Buffer). */
    async composite() {
      const b64 = await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 576; c.height = 288
        const x = c.getContext('2d')
        const pos = { 1: [0, 0], 2: [288, 0], 3: [0, 144], 4: [288, 144] }
        for (const id of [1, 2, 3, 4]) {
          const bytes = new Uint8Array(window.__tiles[id])
          const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
          x.drawImage(img, pos[id][0], pos[id][1])
        }
        return c.toDataURL('image/png').split(',')[1]
      })
      return Buffer.from(b64, 'base64')
    },
    async close() { await browser.close(); srv.close() },
  }
  return app
}

module.exports = { openApp }
