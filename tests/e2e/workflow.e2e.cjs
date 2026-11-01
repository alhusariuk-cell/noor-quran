/**
 * M1.2 experiment B: the structured section-by-section دروس workflow, end to end.
 *
 *   node --no-warnings tests/e2e/workflow.e2e.cjs <dist> [--shots=<dir>]
 *
 * Drives the built app through the mock Even Hub host with real SDK events and
 * real phone clicks, and checks every step against an independent run of the
 * pure model (src/memorisation.ts) with the same seed:
 *   1. Page 50, complete workflow forward (sections 1→2→3, final whole-page
 *      تسطير, COMPLETE) and complete workflow backward to Reading, via SDK events.
 *      Every step: state, every main/preview word's hidden flag, a fresh G2
 *      render, and the phone status text.
 *   2. Single tap does nothing; a burst of swipes cannot skip DONE or a section;
 *      double tap still opens the exit confirmation.
 *   3. Pages 1, 2, 586, 590, 604: full walk (hooks) checked against the model.
 *   4. Pixel checks at checkpoints: hidden words leave only placeholders (main
 *      and preview), ayah markers visible, footer gutters empty, nothing clipped.
 * Software verification only — not a substitute for physical G2 testing.
 */
const { openApp } = require('./harness.cjs')
const assert = require('assert')
const fs = require('fs')

const dist = process.argv[2]
const shots = (process.argv.find(a => a.startsWith('--shots=')) || '').split('=')[1]
const wait = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, fn) => fn().then(
  () => console.log(`ok   - ${name}`),
  e => { failures++; console.log(`FAIL - ${name}\n       ${e.message.split('\n').join('\n       ')}`) })
const ar = n => String(n).replace(/\d/g, d => String.fromCharCode(0x660 + +d))

;(async () => {
  const M = await import('../../src/memorisation.ts')
  const { MUSHAF_DATA } = await import('../../src/mushaf-bundle.ts')
  const getLines = p => MUSHAF_DATA[p] && MUSHAF_DATA[p].lines
  const model = (pageNum, seed, section = 0) => {
    const page = M.buildMemoPage(getLines(pageNum))
    return M.startFlow(page, M.buildExercises(getLines, page, pageNum), seed, section)
  }
  const keyOf = f => `${f.phase}|k${f.k}|s${f.stage}|i${f.index}|v${f.section}`
  const isBoundary = (a, b) => b !== 'exit' && (a.phase !== b.phase || a.k !== b.k)

  const app = await openApp(dist, { offline: true })
  const p = app.page
  await p.setViewportSize({ width: 390, height: 900 })
  const state = () => app.eval(() => window.noor.memo.state)
  const sends = () => app.eval(() => window.__sends)

  /** App vs model: state key and every word's hidden flag (main lines + preview). */
  async function compare(f, where) {
    const s = await state()
    assert.ok(s, `${where}: no session`)
    assert.equal(`${s.phase}|k${s.k}|s${s.stage}|i${s.index}|v${s.section}`, keyOf(f), `${where}: state`)
    const lay = await app.eval(() => window.noor.memo.layout())
    for (const t of lay) if (t.role === 'word') assert.equal(t.hidden, M.flowHidden(f, t.word), `${where}: main word ${t.word}`)
    assert.ok(lay.filter(t => t.role === 'ayah').every(t => !t.hidden))
    const pv = await app.eval(() => window.noor.memo.previewLayout())
    const ex = f.exercises[f.section]
    assert.equal(!!pv, !!ex.preview, `${where}: preview presence`)
    if (pv) for (const t of pv) if (t.role === 'word') assert.equal(t.hidden, M.flowHidden(f, t.word), `${where}: preview word ${t.word}`)
    return s
  }
  async function phoneStatus(f, where) {
    const txt = await p.textContent('#lessonStatus')
    const pr = M.flowProgress(f), sec = `المقطع ${ar(f.k + 1)}/${ar(f.page.sectionCount)}`
    const want = {
      memo: `${sec} · المرحلة ${ar(f.stage)} من ٧`,
      recall: `${sec} · تسطير ${ar(pr.revealed)} من ${ar(pr.total)}`,
      done: `${sec} · ✓ اكتمل`,
      final: `مراجعة الصفحة كاملة · ${ar(pr.revealed)} من ${ar(pr.total)}`,
      complete: `✓ اكتملت الصفحة`,
    }[f.phase]
    assert.ok(txt.includes(want), `${where}: phone shows "${txt}", expected "${want}"`)
    assert.ok(await p.$eval('#lessonPanel', e => e.classList.contains('active')))
  }
  /** Pixel invariants on the current G2 image. */
  async function pixels(where) {
    const png = (await app.composite()).toString('base64')
    const lay = await app.eval(() => window.noor.memo.layout())
    const pv = (await app.eval(() => window.noor.memo.previewLayout())) || []
    const r = await app.eval(async ({ png, lay, pv }) => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }))
      const c = document.createElement('canvas'); c.width = 576; c.height = 288; const x = c.getContext('2d'); x.drawImage(img, 0, 0)
      const A = x.getImageData(0, 0, 576, 288).data
      const scan = (x0, x1, y0, y1, thr) => { let n = 0; for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) if (A[(y * 576 + xx) * 4] > thr) n++; return n }
      const out = { mainHidden: [], mainMarker: [], prevHidden: [], gutters: 0, footerTop: 1e9, footerBottom: -1 }
      const words = new Map()
      for (const t of lay) {
        if (t.role === 'ayah') out.mainMarker.push(scan(Math.ceil(t.x + 1), Math.floor(t.x + t.w - 1), Math.round(t.y - t.fs * 0.6), Math.round(t.y + t.fs * 0.6), 160))
        else if (t.hidden) { const u = words.get(t.word); words.set(t.word, u ? { ...u, l: Math.min(u.l, t.x), r: Math.max(u.r, t.x + t.w) } : { l: t.x, r: t.x + t.w, y: t.y, fs: t.fs }) }
      }
      for (const u of words.values()) {
        const x0 = Math.ceil(u.l + 1), x1 = Math.floor(u.r - 1)
        out.mainHidden.push([scan(x0, x1, Math.round(u.y - u.fs * 0.9), Math.round(u.y + u.fs * 0.9), 160), x1 - x0 + 1])
      }
      for (const t of pv) if (t.hidden) out.prevHidden.push(scan(Math.ceil(t.x + 1), Math.floor(t.x + t.w - 1), 254, 287, 110))
      for (const [a, b] of [[94, 96], [99, 101], [475, 477], [480, 482]]) out.gutters += scan(a, b, 254, 287, 30)
      for (let y = 254; y < 288; y++) for (let xx = 14; xx <= 562; xx++) if (A[(y * 576 + xx) * 4] > 30 && xx !== 97 && xx !== 98 && xx !== 478 && xx !== 479) { out.footerTop = Math.min(out.footerTop, y); out.footerBottom = Math.max(out.footerBottom, y) }
      return out
    }, { png, lay, pv })
    for (const [ink, w] of r.mainHidden) assert.ok(ink <= 2 * w + 4, `${where}: hidden main word still drawn`)
    assert.ok(r.mainMarker.every(n => n > 0), `${where}: an ayah marker is not visible`)
    assert.ok(r.prevHidden.every(n => n === 0), `${where}: hidden preview word still drawn ${r.prevHidden}`)
    assert.equal(r.gutters, 0, `${where}: ink in footer gutters`)
    assert.ok(r.footerTop >= 254 && r.footerBottom <= 286, `${where}: footer ink rows ${r.footerTop}–${r.footerBottom}`)
    return png
  }
  const shot = async name => { if (shots) fs.writeFileSync(`${shots}/${name}.png`, await app.composite()) }

  // ── 1. Page 50: complete workflow forward and backward via SDK events ───────
  await check('Page 50 complete workflow via SDK events: forward to COMPLETE and back to Reading, every step = model', async () => {
    await p.click('#tabPage'); await p.fill('#pageInput', '50'); await p.click('.btn-send'); await p.click('#tabSurahs')
    await app.settle(40); await wait(450)
    const before = await sends()
    await p.click('#btnStartLesson')                                 // real phone button
    await p.waitForFunction(b => window.__sends >= b + 4, before); await app.settle(40)
    const s0 = await state()
    let f = model(50, s0.seed)
    await compare(f, 'start'); await phoneStatus(f, 'start')
    await pixels('s1 stage 0'); await shot('p50-s1-stage0')
    const N = f.page.words.length
    let steps = 0, lastBoundary = false, transitions = []
    const shotsAt = { 'memo|k0|s4': 'p50-s1-stage4', 'memo|k0|s7': 'p50-s1-stage7', 'memo|k1|s0': 'p50-s2-stage0' }
    while (f.phase !== 'complete') {
      const next = M.flowAdvance(f)
      const b = sends()
      await app.event(2, steps % 5 === 0 ? 2 : 1)                    // mix ring (2) and temple (1) sources
      await wait(lastBoundary ? 880 : 430); await app.settle(30)
      assert.ok((await sends()) >= (await b) + 4, `step ${steps}: G2 not refreshed`)
      lastBoundary = isBoundary(f, next)
      if (lastBoundary) transitions.push(`${f.phase}${f.k + 1}→${next.phase}${next.k + 1}`)
      f = next; steps++
      const where = `forward step ${steps} (${keyOf(f)})`
      await compare(f, where); await phoneStatus(f, where)
      const k2 = `${f.phase}|k${f.k}|s${f.stage}`
      if (shotsAt[k2] && f.phase === 'memo') { await pixels(where); await shot(shotsAt[k2]) }
      const ex = f.exercises[f.k], n = M.exerciseCount(ex)
      if (f.phase === 'recall' && f.k === 0 && f.index === Math.floor((ex.mainEnd - ex.start) / 2)) { await pixels(where); await shot('p50-s1-recall-main') }
      if (f.phase === 'recall' && f.k === 0 && f.index === ex.mainEnd - ex.start + 1) { await pixels(where); await shot('p50-s1-recall-preview') }
      if (f.phase === 'done' && f.k === 0) { await pixels(where); await shot('p50-s1-done'); assert.equal(f.index, n - 1) }
      if (f.phase === 'final' && f.index === Math.floor(N / 2)) { await pixels(where); await shot('p50-final-half') }
    }
    await pixels('complete'); await shot('p50-complete')
    assert.deepEqual(transitions, ['memo1→recall1', 'recall1→done1', 'done1→memo2', 'memo2→recall2', 'recall2→done2',
      'done2→memo3', 'memo3→recall3', 'recall3→done3', 'done3→final3', 'final3→complete3'])
    const sectionWords = f.exercises.reduce((a, e) => a + M.exerciseCount(e), 0)
    assert.equal(steps, 3 * 8 + sectionWords + 3 + N)                 // stages+entry, section reveals, DONE→next, final reveals
    console.log(`       forward: ${steps} SDK steps; section exercises ${f.exercises.map(e => `${e.mainEnd - e.start}+${e.end - e.mainEnd}`).join(', ')} words (main+preview); final ${N} words`)
    // Backward, all the way to Reading
    let back = 0; lastBoundary = false
    for (;;) {
      const prev = M.flowBack(f)
      await app.event(1); await wait(lastBoundary ? 880 : 430); await app.settle(30)
      back++
      if (prev === 'exit') break
      lastBoundary = isBoundary(f, prev)
      f = prev
      await compare(f, `back step ${back} (${keyOf(f)})`)
    }
    assert.equal(await app.eval(() => window.noor.mode), 'reading')
    assert.equal(await app.eval(() => window.noor.page), 50)
    assert.equal(back, steps + 1)
    console.log(`       backward: ${back} SDK steps to Reading`)
  })

  // ── 2. Gesture safety ────────────────────────────────────────────────────────
  await check('Single tap never acts; bursts cannot skip DONE or a section; double tap opens exit confirmation', async () => {
    await app.render(() => window.noor.startLesson(77))
    let f = model(50, 77)
    const tapNoop = async where => {
      const s1 = JSON.stringify(await state()), n = await sends()
      await app.event(0); await wait(700)
      assert.equal(JSON.stringify(await state()), s1, `${where}: tap changed state`)
      assert.equal(await sends(), n, `${where}: tap re-rendered`)
    }
    const hookTo = async pred => { while (!pred(f)) { f = M.flowAdvance(f); await app.eval(() => window.noor.memo.advance()) } await app.settle(40) }
    await hookTo(g => g.phase === 'memo' && g.stage === 3); await tapNoop('stage 3')
    await hookTo(g => g.phase === 'recall' && g.index === 5); await tapNoop('section recall')
    // Burst at the last word: 4 swipes 150 ms apart → only DONE, never the next section
    await hookTo(g => g.phase === 'recall' && g.index === M.exerciseCount(g.exercises[0]) - 2)
    await wait(900)
    for (let i = 0; i < 4; i++) { await app.event(2); await wait(150) }
    await wait(500); await app.settle(40)
    let s = await state(); assert.equal(s.phase, 'done'); assert.equal(s.k, 0)
    await tapNoop('DONE')
    // Burst at DONE → exactly one transition (section 2, stage 0)
    await wait(900)
    for (let i = 0; i < 4; i++) { await app.event(2); await wait(150) }
    await wait(500); await app.settle(40)
    s = await state(); assert.equal(s.phase, 'memo'); assert.equal(s.k, 1); assert.ok(s.stage <= 1, `burst skipped to stage ${s.stage}`)
    // Burst backwards at section 2 stage 0 → only back to section 1 DONE
    await app.eval(() => { while (window.noor.memo.state.stage > 0) window.noor.memo.back() })
    await wait(900)
    for (let i = 0; i < 4; i++) { await app.event(1); await wait(150) }
    await wait(500); await app.settle(40)
    s = await state(); assert.equal(s.phase, 'done'); assert.equal(s.k, 0)
    // Final recall: tap still ignored
    await app.eval(() => { for (let g = 0; g < 2000 && window.noor.memo.state.phase !== 'final'; g++) window.noor.memo.advance(); window.noor.memo.advance() })
    await app.settle(40); await tapNoop('final recall')
    // Double tap → existing exit confirmation
    await app.eval(() => { window.__calls = [] })
    await app.event(3); await wait(300)
    assert.ok((await app.eval(() => window.__calls)).includes('shutDownPageContainer'))
    assert.equal(await app.eval(() => window.noor.mode), 'memo')
  })

  // ── 3. Edge pages: full walk with hooks, every step = model ─────────────────
  await check('Pages 1, 2, 586, 590, 604: full workflow forward and back, every step = model', async () => {
    for (const pg of [1, 2, 586, 590, 604]) {
      await app.render(pg => window.noor.jumpToPage(pg), pg)
      await app.render(() => window.noor.startLesson(31))
      let f = model(pg, 31), steps = 0
      await compare(f, `page ${pg} start`)
      while (f.phase !== 'complete') {
        f = M.flowAdvance(f); await app.eval(() => window.noor.memo.advance()); steps++
        if (steps % 7 === 0 || f.phase !== 'memo') await compare(f, `page ${pg} step ${steps}`)
      }
      await app.settle(40); await compare(f, `page ${pg} complete`); await pixels(`page ${pg} complete`)
      if (pg === 604) {
        const last = f.exercises[f.exercises.length - 1]
        assert.equal(last.preview, null); assert.equal(last.end, last.mainEnd)
      }
      for (;;) {
        const prev = M.flowBack(f)
        await app.eval(() => window.noor.memo.back())
        if (prev === 'exit') break
        f = prev
        if (f.phase !== 'memo' || f.stage === 0) await compare(f, `page ${pg} back`)
      }
      assert.equal(await app.eval(() => window.noor.mode), 'reading')
      console.log(`       page ${pg}: ${f.exercises.length} sections, ${steps} steps each way`)
    }
  })

  // ── 4. Standalone تسطير and Reading Mode still work ─────────────────────────
  await check('Standalone تسطير from the phone: page-wide recall, preview follows recall state, tap moves sections', async () => {
    await app.render(() => window.noor.jumpToPage(50))
    await app.render(() => document.getElementById('btnStartTasteer').click())
    let s = await state(); assert.equal(s.activity, 'tasteer'); assert.equal(s.index, -1); assert.equal(s.total, 135)
    const pv = await app.eval(() => window.noor.memo.previewLayout())
    assert.ok(pv.filter(t => t.role === 'word').every(t => t.hidden))   // in-page preview words not yet recalled
    assert.ok(await p.$eval('#tasteerPanel', e => e.classList.contains('active')))
    await app.event(0); await wait(700); await app.settle(40)
    s = await state(); assert.equal(s.section, 1)                        // tap → next section (M1.1 behaviour)
    await app.render(() => window.noor.endActivity())
    assert.equal(await app.eval(() => window.noor.mode), 'reading')
  })

  await app.close()
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall workflow e2e checks passed')
  process.exit(failures ? 1 : 0)
})()
