/**
 * End-to-end checks of a built bundle through a mock Even Hub host.
 *
 *   node tests/e2e/memo.e2e.cjs <dist> [<reference v4.7.0 dist>] [--pages=all|sample]
 *        [--range=FROM-TO] [--only=1,2,...]
 *   (--range limits the page set for checks 1–2; --only runs selected checks)
 *
 * 1. Reading Mode regression: every screen of every page renders byte-identical
 *    tiles to the reference build (when a reference dist is given).
 * 2. Memorisation stage 0 draws the text area pixel-identical to Reading Mode,
 *    and leaving memorisation returns to the same Reading screen.
 * 3. Real SDK event routing in memorisation (stages, sections, recall, exit),
 *    including double press still opening the exit popup.
 * 4. Hidden placeholders only change pixels inside word areas; ayah markers,
 *    header and basmala stay identical at stage 7.
 * 5. Footer columns never collide.
 *
 * Software verification only — not a substitute for physical G2 testing.
 */
const { openApp } = require('./harness.cjs')
const assert = require('assert')

const [dist, refDist] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const sample = process.argv.includes('--pages=sample')
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1]
const range = (arg('range') || '1-604').split('-').map(Number)
const only = arg('only') ? new Set(arg('only').split(',').map(Number)) : null
const run = n => !only || only.has(n)
const PAGES = (sample
  ? [1, 2, 3, 50, 77, 151, 187, 255, 293, 300, 302, 400, 500, 586, 590, 600, 603, 604]
  : Array.from({ length: 604 }, (_, i) => i + 1)).filter(p => p >= range[0] && p <= range[1])
const wait = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, fn) => fn().then(
  () => console.log(`ok   - ${name}`),
  e => { failures++; console.log(`FAIL - ${name}\n       ${e.message.split('\n').join('\n       ')}`) })

/** Pixel analysis in the page: compare two composite PNGs (base64). */
async function diffRegions(app, a, b) {
  return app.eval(async ([a, b]) => {
    const load = async s => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], { type: 'image/png' }))
      const c = document.createElement('canvas'); c.width = 576; c.height = 288
      const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 576, 288).data
    }
    const A = await load(a), B = await load(b)
    const rows = new Set()
    let changed = 0
    for (let y = 0; y < 288; y++) for (let x = 0; x < 576; x++) {
      const i = (y * 576 + x) * 4
      if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) { changed++; rows.add(y) }
    }
    return { changed, rows: [...rows] }
  }, [a.toString('base64'), b.toString('base64')])
}

async function footerInkColumns(app, png) {
  return app.eval(async s => {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], { type: 'image/png' }))
    const c = document.createElement('canvas'); c.width = 576; c.height = 288
    const x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 260, 576, 28).data
    const cols = []
    for (let cx = 0; cx < 576; cx++) {
      let ink = false
      for (let y = 0; y < 28 && !ink; y++) if (d[(y * 576 + cx) * 4] > 40) ink = true
      cols.push(ink)
    }
    // Merge ink into clusters separated by gaps of at least 6 px
    const clusters = []
    let start = -1, lastInk = -100
    cols.forEach((ink, cx) => {
      if (!ink) return
      if (cx - lastInk > 6) { if (start >= 0) clusters.push([start, lastInk]); start = cx }
      lastInk = cx
    })
    if (start >= 0) clusters.push([start, lastInk])
    return clusters
  }, png.toString('base64'))
}

;(async () => {
  const app = await openApp(dist)

  // ── 1. Reading Mode regression against v4.7.0 ──────────────────────────────
  if (refDist && run(1)) {
    await check(`Reading Mode tiles byte-identical to v4.7.0 (${PAGES.length} pages, every screen)`, async () => {
      const ref = await openApp(refDist)
      let screens = 0
      for (const p of PAGES) {
        let a = await app.render(p => window.noor.jumpToPage(p), p)
        let b = await ref.render(p => window.noor.jumpToPage(p), p)
        const n = await app.eval(() => window.noor.totalScreens)
        for (let k = 0; k < n; k++) {
          if (k > 0) {
            a = await app.render(() => window.noor.nextScreen())
            b = await ref.render(() => window.noor.nextScreen())
          }
          for (let t = 0; t < 4; t++) assert.ok(a[t].equals(b[t]), `page ${p} screen ${k + 1} tile ${t + 1} differs`)
          screens++
        }
        await wait(410)   // nav debounce
      }
      await ref.close()
      console.log(`       ${screens} screens compared`)
    })
  }

  // ── 2. Stage 0 equals Reading text area; exit returns to the same screen ───
  if (run(2)) await check(`Memorisation stage 0 text area identical to Reading (${PAGES.length} pages, every screen)`, async () => {
    let screens = 0
    for (const p of PAGES) {
      await app.render(p => window.noor.jumpToPage(p), p)
      const n = await app.eval(() => window.noor.totalScreens)
      for (let k = 0; k < n; k++) {
        if (k > 0) { await wait(410); await app.render(() => window.noor.nextScreen()) }
        const reading = await app.composite()
        await app.render(() => window.noor.memo.start(12345))
        const st = await app.eval(() => window.noor.memo.state)
        assert.equal(st.section, k, `page ${p}: memo did not open on screen ${k + 1}`)
        const memo = await app.composite()
        const d = await diffRegions(app, reading, memo)
        // Rows 0–252 hold the five Quran lines (lowest ink anywhere: y = 250.2). From M1.2 the
        // memorisation footer separator is at y = 253, so rows 253–287 differ by design.
        const bad = d.rows.filter(y => y < 253)
        assert.equal(bad.length, 0, `page ${p} screen ${k + 1}: text area differs on rows ${bad.slice(0, 5)}`)
        // M1.2-B: back from stage 0 of a later section goes to the previous section's DONE, so leave via End
        await app.render(() => window.noor.endActivity())
        assert.equal(await app.eval(() => window.noor.mode), 'reading')
        assert.equal(await app.eval(() => window.noor.screen), k, `page ${p}: exit changed screen`)
        const again = await app.composite()
        assert.equal((await diffRegions(app, reading, again)).changed, 0, `page ${p} screen ${k + 1}: Reading differs after exit`)
        screens++
      }
    }
    console.log(`       ${screens} screens compared`)
  })

  // ── 3. Real SDK events ──────────────────────────────────────────────────────
  if (run(3)) await check('SDK event routing (structured دروس): selector entry, stages, tap ignored, recall, back to Reading, double press', async () => {
    const st = () => app.eval(() => window.noor.memo.state)
    const ev = async (t, src = 1, gap = 430) => { await app.event(t, src); await wait(gap); await app.settle(40) }
    for (const [p, sections] of [[1, 2], [586, 3], [604, 3]]) {
      await app.render(p => window.noor.jumpToPage(p), p); await wait(700)
      await ev(0)                                                     // tap → selector
      assert.equal(await app.eval(() => window.noor.mode), 'selector')
      await ev(1)                                                     // SCROLL_TOP → memo row
      await ev(0)                                                     // confirm
      assert.equal(await app.eval(() => window.noor.mode), 'memo', `page ${p}: memo not started`)
      let s = await st(); assert.equal(s.activity, 'lesson'); assert.equal(s.k, 0); assert.equal(s.stage, 0); assert.equal(s.sectionCount, sections)
      await ev(2); await ev(2, 2)                                     // SCROLL_BOTTOM ×2 (temple, ring source)
      s = await st(); assert.equal(s.stage, 2)
      await ev(1); s = await st(); assert.equal(s.stage, 1)          // SCROLL_TOP
      const sends = await app.eval(() => window.__sends)
      for (let i = 0; i < 3; i++) await ev(0, 1, 700)                 // taps do nothing in the structured flow
      s = await st(); assert.equal(s.k, 0); assert.equal(s.section, 0); assert.equal(s.stage, 1)
      assert.equal(await app.eval(() => window.__sends), sends, 'tap caused a re-render')
      for (let i = 0; i < 7; i++) await ev(2, 1, 900)                 // → stage 7 → recall (boundary cooldown)
      s = await st(); assert.equal(s.phase, 'recall'); assert.equal(s.index, -1)
      await ev(2); await ev(2); s = await st(); assert.equal(s.index, 1)
      await ev(1); s = await st(); assert.equal(s.index, 0)
      await ev(1); await ev(1, 1, 900); s = await st(); assert.equal(s.phase, 'memo'); assert.equal(s.stage, 7)
      for (let i = 0; i < 8; i++) await ev(1, 1, 900)                 // 7 → 0 → Reading (section 1)
      assert.equal(await app.eval(() => window.noor.mode), 'reading')
      assert.equal(await app.eval(() => window.noor.page), p)
    }
    // Double press in memorisation keeps the existing exit popup behaviour
    await app.render(() => window.noor.memo.start(1))
    await app.eval(() => { window.__calls = [] })
    await app.event(3); await wait(300)
    const calls = await app.eval(() => window.__calls)
    assert.ok(calls.includes('shutDownPageContainer'), `double press did not request the exit popup: ${calls}`)
    const lines = app.consoleLines.filter(l => l.includes('[memo] input'))
    assert.ok(lines.some(l => l.includes('eventSource=2')), 'event source not logged')
  })

  // ── 4. Placeholders change only word pixels ─────────────────────────────────
  if (run(4)) await check('Stage 7: ayah markers, header and basmala pixel-identical; hidden words replaced by placeholders', async () => {
    let markers = 0, hiddenWords = 0
    for (const p of [2, 50, 187, 302, 586, 604]) {
      await app.render(p => window.noor.jumpToPage(p), p)
      const n = await app.eval(() => window.noor.totalScreens)
      for (let k = 0; k < n; k++) {
        // Start the flow on section k (test hook starts at the current screen's section)
        await app.render(p => window.noor.jumpToPage(p), p)
        for (let j = 0; j < k; j++) { await wait(410); await app.render(() => window.noor.nextScreen()) }
        await app.render(() => window.noor.memo.start(777))
        const img0 = await app.composite()
        await app.render(() => { for (let i = 0; i < 7; i++) window.noor.memo.advance() })
        const img7 = await app.composite()
        const boxes = await app.eval(() => window.noor.memo.layout())
        const res = await app.eval(async ([a, b, boxes]) => {
          const load = async s => {
            const img = await createImageBitmap(new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], { type: 'image/png' }))
            const c = document.createElement('canvas'); c.width = 576; c.height = 288
            const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 576, 288).data
          }
          const A = await load(a), B = await load(b)
          const out = { markerDiffs: [], wordInk: [], ok: 0 }
          const scan = (x0, x1, y0, y1) => {
            let diff = 0, ink7 = 0, ink0 = 0
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
              const i = (y * 576 + x) * 4
              if (A[i] !== B[i]) diff++
              if (B[i] > 128) ink7++
              if (A[i] > 128) ink0++
            }
            return { diff, ink7, ink0 }
          }
          // Ayah markers: inner box (1 px in from each side to skip neighbouring overhang)
          for (const bx of boxes.filter(b => b.role === 'ayah')) {
            const r = scan(Math.ceil(bx.x + 1), Math.floor(bx.x + bx.w - 1),
              Math.round(bx.y - bx.fs * 0.6), Math.round(bx.y + bx.fs * 0.6))
            if (r.diff) out.markerDiffs.push(r.diff); else out.ok++
          }
          // Hidden words: union of the word's tokens (word + any pause mark), full glyph height
          const words = new Map()
          for (const bx of boxes.filter(b => b.hidden)) {
            const u = words.get(bx.word)
            words.set(bx.word, u ? { ...u, l: Math.min(u.l, bx.x), r: Math.max(u.r, bx.x + bx.w) } : { l: bx.x, r: bx.x + bx.w, y: bx.y, fs: bx.fs })
          }
          for (const u of words.values()) {
            const x0 = Math.ceil(u.l + 1), x1 = Math.floor(u.r - 1)
            const r = scan(x0, x1, Math.round(u.y - u.fs * 0.9), Math.round(u.y + u.fs * 0.9))
            out.wordInk.push([r.ink0, r.ink7, x1 - x0 + 1])
          }
          return out
        }, [img0.toString('base64'), img7.toString('base64'), boxes])
        assert.equal(res.markerDiffs.length, 0, `page ${p} section ${k + 1}: ayah marker pixels changed ${res.markerDiffs}`)
        markers += res.ok
        for (const [ink0, ink7, w] of res.wordInk) {
          // A hidden word keeps at most its 2-px placeholder line of bright pixels
          assert.ok(ink0 > 0, `page ${p}: hidden word box had no ink at stage 0`)
          assert.ok(ink7 <= 2 * w + 4, `page ${p}: hidden word still drawn (ink ${ink7}, width ${w})`)
          hiddenWords++
        }
        const d = await diffRegions(app, img0, img7)
        if (k === 0 && (p === 2 || p === 50)) assert.ok(!d.rows.some(y => y < 102), `page ${p}: header/basmala rows changed`)
      }
      await app.render(() => { window.noor.jumpToPage(1) })
    }
    console.log(`       ${markers} ayah markers unchanged, ${hiddenWords} hidden words verified`)
  })

  // ── 5. Footer collisions ────────────────────────────────────────────────────
  if (run(5)) await check('Footer: three separate columns in memorisation and recall (incl. 3-digit counts)', async () => {
    for (const p of [1, 302, 604, 249]) {
      await app.render(p => window.noor.jumpToPage(p), p)
      await app.render(() => window.noor.memo.start(5))
      for (let i = 0; i < 3; i++) await app.eval(() => window.noor.memo.advance())
      await app.render(() => window.noor.memo.advance())
      let cl = await footerInkColumns(app, await app.composite())
      assert.ok(cl.length >= 3, `page ${p} memo footer clusters ${JSON.stringify(cl)}`)
      // Move to full recall (largest counts)
      await app.render(() => { for (let i = 0; i < 4; i++) window.noor.memo.advance(); for (let i = 0; i < 400; i++) window.noor.memo.advance() })
      cl = await footerInkColumns(app, await app.composite())
      assert.ok(cl.length >= 3, `page ${p} recall footer clusters ${JSON.stringify(cl)}`)
      assert.ok(cl[0][0] >= 14 && cl[cl.length - 1][1] <= 562, `page ${p}: footer outside column ${JSON.stringify(cl)}`)
      await app.render(() => window.noor.jumpToPage(1))
    }
  })

  await app.close()
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall e2e checks passed')
  process.exit(failures ? 1 : 0)
})()
