/**
 * M1.2 experiment A: next-line preview footer, checked on real rendered tiles.
 *
 *   node tests/e2e/preview.e2e.cjs <dist> [--samples=<dir>]
 *
 * 1. Analytic, all 1,809 previews: the fitted preview text's ink stays inside the
 *    footer row (no clipping) and inside the 372 px preview zone.
 * 2. Pixel checks on pages 1, 2, 50, 186, 226, 586, 590 and 604 (every section;
 *    دروس stages 0/4/7, recall, تسطير):
 *    - Quran rows 0–252 identical to Reading (the five lines keep their positions)
 *    - the preview zone is pixel-identical to the expected next line drawn alone
 *      (so the preview is exactly that Mushaf line, verbatim)
 *    - preview and status ink stay inside their zones with empty gutters (no overlap)
 *    - all footer ink lies in rows 254–286 (not clipped)
 *    - page 604 section 3 shows no preview
 * Software verification only — not a substitute for physical G2 testing.
 */
const { openApp } = require('./harness.cjs')
const assert = require('assert')
const fs = require('fs')

const dist = process.argv[2]
const samples = (process.argv.find(a => a.startsWith('--samples=')) || '').split('=')[1]
const PAGES = [1, 2, 50, 186, 226, 586, 590, 604]
let failures = 0
const check = (name, fn) => fn().then(
  () => console.log(`ok   - ${name}`),
  e => { failures++; console.log(`FAIL - ${name}\n       ${e.message.split('\n').join('\n       ')}`) })

// Geometry under test (src/main.ts, drawMemoFooter)
const G = { sepY: 253, footY: 272.5, size: 16, min: 12, maxW: 372, color: '#8a8a8a',
  leftZone: [14, 93], rightZone: [483, 562], previewZone: [102, 474], rules: [97, 98, 478, 479] }

;(async () => {
  const app = await openApp(dist)
  const { nextPreviewLine } = await import('../../src/memorisation.ts')
  const { MUSHAF_DATA } = await import('../../src/mushaf-bundle.ts')
  const getLines = p => MUSHAF_DATA[p] && MUSHAF_DATA[p].lines

  await check('All 1,809 previews: fitted ink inside rows 254–286 and the 372 px zone (analytic, real font)', async () => {
    const items = []
    for (let p = 1; p <= 604; p++) {
      const n = Math.ceil(MUSHAF_DATA[p].lines.length / 5)
      for (let k = 0; k < n; k++) { const v = nextPreviewLine(getLines, p, k); if (v) items.push([p, k, v.text]) }
    }
    const res = await app.eval(({ items, G }) => {
      const c = document.createElement('canvas').getContext('2d'); c.textBaseline = 'middle'; c.direction = 'rtl'
      const bad = []; let maxW = 0, shrunk = 0, top = 1e9, bottom = 0
      for (const [p, k, t] of items) {
        let fs = G.size; c.font = `${fs}px 'UthmanicHafs', serif`
        while (c.measureText(t).width > G.maxW && fs > G.min) { fs--; c.font = `${fs}px 'UthmanicHafs', serif` }
        const m = c.measureText(t)
        if (fs < G.size) shrunk++
        maxW = Math.max(maxW, m.width)
        const y0 = G.footY - m.actualBoundingBoxAscent, y1 = G.footY + m.actualBoundingBoxDescent
        top = Math.min(top, y0); bottom = Math.max(bottom, y1)
        if (y0 < G.sepY + 1 || y1 > 287 || m.width > G.maxW) bad.push(`${p}:${k + 1}`)
      }
      return { bad, maxW, shrunk, top, bottom }
    }, { items, G })
    assert.equal(items.length, 1809)
    assert.equal(res.bad.length, 0, `outside the footer row: ${res.bad.slice(0, 10)}`)
    console.log(`       widest preview ${res.maxW.toFixed(1)} px; shrunk below 16 px: ${res.shrunk}; ink rows ${res.top.toFixed(1)}–${res.bottom.toFixed(1)}`)
  })

  await check('Pages 1, 2, 50, 186, 226, 586, 590, 604: lines unchanged, exact preview, no clipping, no overlap', async () => {
    let screens = 0
    for (const p of PAGES) {
      await app.render(p => window.noor.jumpToPage(p), p)
      const n = await app.eval(() => window.noor.totalScreens)
      for (let k = 0; k < n; k++) {
        // Reading render of this section, for the line-position comparison
        await app.render(p => window.noor.jumpToPage(p), p)
        for (let j = 0; j < k; j++) { await new Promise(r => setTimeout(r, 410)); await app.render(() => window.noor.nextScreen()) }
        const reading = (await app.composite()).toString('base64')
        const expected = nextPreviewLine(getLines, p, k)
        const states = [
          ['lesson-s0', () => { window.noor.memo.start(11) }],
          ['lesson-s4', () => { for (let i = 0; i < 4; i++) window.noor.memo.advance() }],
          ['lesson-s7', () => { for (let i = 0; i < 3; i++) window.noor.memo.advance() }],
          ['recall', () => { for (let i = 0; i < 6; i++) window.noor.memo.advance() }],
          ['done', () => { for (let g = 0; g < 500 && window.noor.memo.state.phase !== 'done'; g++) window.noor.memo.advance() }],
        ]
        for (const [name, fn] of states) {
          await app.render(fn)
          const st = await app.eval(() => window.noor.memo.state)
          if (name === 'lesson-s0') assert.equal(st.section, k)
          // Recall moves the view to the revealed word's section, so expect that section's preview
          await checkScreen(app, { p, k: st.section, name, reading, expected: nextPreviewLine(getLines, p, st.section), st })
          if (samples && name !== 'recall') fs.writeFileSync(`${samples}/p${p}-s${k + 1}-${name}.png`, await app.composite())
          screens++
        }
        await app.render(() => { window.noor.endActivity() })
        // تسطير starts at section 1; tap to this section
        await app.render(p => window.noor.jumpToPage(p), p)
        await app.render(k => { window.noor.startTasteer(5); for (let i = 0; i < k; i++) window.noor.memo.tap() }, k)
        await checkScreen(app, { p, k, name: 'tasteer', reading, expected, st: await app.eval(() => window.noor.memo.state) })
        if (samples) fs.writeFileSync(`${samples}/p${p}-s${k + 1}-tasteer.png`, await app.composite())
        screens++
        await app.render(() => { window.noor.endActivity() })
      }
    }
    console.log(`       ${screens} memorisation screens checked`)
  })

  await app.close()
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall preview e2e checks passed')
  process.exit(failures ? 1 : 0)
})()

async function checkScreen(app, { p, k, name, reading, expected, st }) {
  const where = `page ${p} section ${k + 1} ${name}`
  const shown = await app.eval(() => window.noor.memo.preview())
  assert.deepEqual(shown, expected, `${where}: preview line differs from the expected next text line`)
  const png = (await app.composite()).toString('base64')
  const ptoks = (await app.eval(() => window.noor.memo.previewLayout())) || []
  const r = await app.eval(async ({ png, reading, text, G, stage0, ptoks }) => {
    const load = async s => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], { type: 'image/png' }))
      const c = document.createElement('canvas'); c.width = 576; c.height = 288; const x = c.getContext('2d'); x.drawImage(img, 0, 0)
      return x.getImageData(0, 0, 576, 288).data
    }
    const A = await load(png), R = await load(reading)
    const lit = (D, x, y) => D[(y * 576 + x) * 4] > 30
    const out = {}
    // Five Quran lines: rows 0–252 identical to Reading at stage 0
    if (stage0) { let diff = 0; for (let i = 0; i < 576 * 253 * 4; i += 4) if (A[i] !== R[i]) diff++; out.lineDiff = diff }
    // Expected preview drawn alone with the same settings
    const c = document.createElement('canvas'); c.width = 576; c.height = 288; const x = c.getContext('2d')
    x.fillStyle = '#000'; x.fillRect(0, 0, 576, 288)
    if (text) {
      x.textBaseline = 'middle'; let fs = G.size; x.font = `${fs}px 'UthmanicHafs', serif`
      while (x.measureText(text).width > G.maxW && fs > G.min) { fs--; x.font = `${fs}px 'UthmanicHafs', serif` }
      x.fillStyle = G.color; x.textAlign = 'center'; x.direction = 'rtl'; x.fillText(text, 288, G.footY)
    }
    const E = x.getImageData(0, 0, 576, 288).data
    let previewDiff = 0
    const anyHidden = ptoks.some(t => t.hidden)
    if (!anyHidden) {
      // Everything visible: the preview zone must equal the exact line drawn alone
      for (let y = G.sepY + 1; y < 288; y++) for (let xx = G.previewZone[0] - 2; xx <= G.previewZone[1] + 2; xx++) {
        const i = (y * 576 + xx) * 4; if (A[i] !== E[i]) previewDiff++
      }
    } else {
      // Visible words match the exact line inside their own boxes; hidden words show only a placeholder
      out.hiddenInk = []
      for (const t of ptoks) {
        const x0 = Math.ceil(t.x + 1), x1 = Math.floor(t.x + t.w - 1)
        let bright = 0, d = 0
        for (let y = G.sepY + 1; y < 288; y++) for (let xx = x0; xx <= x1; xx++) {
          const i = (y * 576 + xx) * 4
          if (t.hidden) { if (A[i] > 110) bright++ }      // text #8a8a8a (138) vs placeholder #666 (102)
          else if (A[i] !== E[i]) d++
        }
        if (t.hidden) out.hiddenInk.push(bright); else previewDiff += d
      }
    }
    out.previewDiff = previewDiff
    // Footer ink bounds by region (rows 254–287), excluding the zone rules
    const box = (x0, x1) => { let t = 1e9, b = -1, l = 1e9, rr = -1
      for (let y = G.sepY + 1; y < 288; y++) for (let xx = x0; xx <= x1; xx++) if (!G.rules.includes(xx) && lit(A, xx, y)) { t = Math.min(t, y); b = Math.max(b, y); l = Math.min(l, xx); rr = Math.max(rr, xx) }
      return b < 0 ? null : [l, t, rr, b] }
    out.left = box(0, 93); out.gapL = box(94, 101); out.preview = box(102, 474); out.gapR = box(475, 482); out.right = box(483, 575)
    return out
  }, { png, reading, text: expected && expected.text, G, stage0: name === 'lesson-s0', ptoks })
  if (name === 'lesson-s0') assert.equal(r.lineDiff, 0, `${where}: Quran rows 0–252 differ from Reading`)
  assert.equal(r.previewDiff, 0, `${where}: visible preview pixels differ from the expected line (${r.previewDiff})`)
  if (r.hiddenInk) assert.ok(r.hiddenInk.every(n => n === 0), `${where}: hidden preview word still drawn ${r.hiddenInk}`)
  if (!expected) assert.equal(r.preview, null, `${where}: preview drawn where none expected`)
  else assert.ok(r.preview, `${where}: preview missing`)
  assert.equal(r.gapL, null, `${where}: ink in left gutter ${r.gapL}`)
  assert.equal(r.gapR, null, `${where}: ink in right gutter ${r.gapR}`)
  for (const [zone, b] of [['left', r.left], ['preview', r.preview], ['right', r.right]]) {
    if (!b) continue
    assert.ok(b[1] >= 254 && b[3] <= 286, `${where}: ${zone} ink rows ${b[1]}–${b[3]} clipped / touching edge`)
  }
  assert.ok(r.left && r.left[0] >= 14 && r.left[2] <= 93, `${where}: left status ${r.left}`)
  assert.ok(r.right && r.right[0] >= 483 && r.right[2] <= 562, `${where}: right status ${r.right}`)
}
