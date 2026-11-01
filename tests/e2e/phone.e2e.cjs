/**
 * M1.1 phone-UI end-to-end checks through the mock Even Hub host.
 *
 *   node tests/e2e/phone.e2e.cjs <dist>
 *
 * Clicks the real phone controls in index.html (same WebView as the glasses
 * logic), injects real SDK events for G2 gestures, and inspects the image
 * tiles sent to the glasses and the phone panel text. Runs with all network
 * access except the local app server blocked (offline).
 *
 * Software verification only — not a substitute for physical G2 testing.
 */
const { openApp } = require('./harness.cjs')
const assert = require('assert')

const dist = process.argv[2]
const wait = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, fn) => fn().then(
  () => console.log(`ok   - ${name}`),
  e => { failures++; console.log(`FAIL - ${name}\n       ${e.message.split('\n').join('\n       ')}`) })

;(async () => {
  const app = await openApp(dist, { offline: true })
  const p = app.page
  await p.setViewportSize({ width: 390, height: 900 })
  const state = () => app.eval(() => window.noor.memo.state)
  const sends = () => app.eval(() => window.__sends)
  const text = sel => p.textContent(sel)
  const ev = async (t, src = 1) => { await app.event(t, src); await wait(430); await app.settle(40) }
  /** Click a phone control and require a fresh 4-tile G2 render. */
  const click = async sel => {
    const before = await sends()
    await p.click(sel)
    await p.waitForFunction(b => window.__sends >= b + 4, before, { timeout: 10000 })
    await app.settle(40)
  }
  /** Use the phone's own Page tab to select a page. */
  const selectPage = async n => {
    await p.click('#tabPage'); await p.fill('#pageInput', String(n)); await click('.btn-send'); await p.click('#tabSurahs')
    await wait(420)
  }
  /** Hidden/visible state of the displayed section, from the renderer's own layout. */
  const layout = () => app.eval(() => window.noor.memo.layout())

  await check('Offline: app starts and renders with all external network blocked', async () => {
    assert.ok((await sends()) >= 4)
    assert.equal(await app.eval(() => document.fonts.check("16px 'UthmanicHafs'")), true, 'Uthmanic Hafs not loaded')
    console.log(`       blocked external requests: ${app.blocked.length} (${[...new Set(app.blocked.map(u => new URL(u).host))].join(', ') || 'none'})`)
  })

  await check('دروس from the phone: selected page, stage 0, first section, G2 refreshed, footer + phone status', async () => {
    for (const page of [50, 1, 586]) {
      await selectPage(page)
      await click('#btnStartLesson')
      const s = await state()
      assert.equal(await app.eval(() => window.noor.page), page)
      assert.equal(s.activity, 'lesson'); assert.equal(s.phase, 'memo'); assert.equal(s.stage, 0); assert.equal(s.section, 0)
      assert.ok((await layout()).every(t => !t.hidden), 'words hidden at stage 0')
      assert.match(await text('#lessonPanel'), /المرحلة ٠ من ٧/)
      assert.ok(await p.$eval('#lessonPanel', e => e.classList.contains('active')))
      assert.ok(!(await p.$eval('#tasteerPanel', e => e.classList.contains('active'))))
      const label = await text('#lessonPage')
      assert.ok(label.includes(String(page).replace(/\d/g, d => String.fromCharCode(0x660 + +d))), `panel page label ${label}`)
    }
  })

  await check('تسطير from the phone: recall, all eligible words hidden, ayah markers kept, 0 revealed, first section', async () => {
    for (const page of [302, 2, 590]) {
      await selectPage(page)
      await click('#btnStartTasteer')
      const s = await state()
      assert.equal(s.activity, 'tasteer'); assert.equal(s.phase, 'recall'); assert.equal(s.recallIndex, -1); assert.equal(s.section, 0)
      const lay = await layout()
      assert.ok(lay.filter(t => t.role === 'word').every(t => t.hidden), 'a word is visible at start')
      assert.ok(lay.some(t => t.role === 'ayah') || page === 590, 'no ayah marker in first section')
      assert.ok(lay.filter(t => t.role === 'ayah').every(t => !t.hidden))
      assert.match(await text('#tasteerPanel'), new RegExp(`ظهرت ٠ من ${String(s.words).replace(/\d/g, d => String.fromCharCode(0x660 + +d))}`))
      assert.ok(await p.$eval('#tasteerPanel', e => e.classList.contains('active')))
    }
  })

  await check('Page selection by surah list and juz grid is used by both activities', async () => {
    await p.click('.surah-item:nth-child(18)'); await app.settle(40); await wait(420)    // al-Kahf p.293
    await click('#btnStartLesson'); assert.equal(await app.eval(() => window.noor.page), 293)
    await p.click('#tabJuz'); await p.click('.juz-item:nth-child(30)'); await app.settle(40); await wait(420)  // juz 30 p.582
    await p.click('#tabSurahs')
    await click('#btnStartTasteer'); assert.equal(await app.eval(() => window.noor.page), 582)
    assert.equal((await state()).activity, 'tasteer')
  })

  await check('Seven stages via SDK events, reversible (4 → 3 → 4), phone indicator follows each gesture', async () => {
    await selectPage(50); await click('#btnStartLesson')
    const hiddenAt = {}
    for (let k = 1; k <= 7; k++) {
      await ev(2)
      const s = await state(); assert.equal(s.stage, k)
      assert.match(await text('#lessonStatus'), new RegExp(`المرحلة ${String.fromCharCode(0x660 + k)} من ٧`))
      assert.equal(await p.$$eval('#lessonStatus .act-dot.on', d => d.length), k)
      hiddenAt[k] = (await layout()).filter(t => t.hidden).map(t => `${t.word}`).join(',')
    }
    await ev(1); await ev(1); await ev(1); assert.equal((await state()).stage, 4)
    assert.equal((await layout()).filter(t => t.hidden).map(t => `${t.word}`).join(','), hiddenAt[4])
    await ev(1); assert.equal((await state()).stage, 3)
    assert.equal((await layout()).filter(t => t.hidden).map(t => `${t.word}`).join(','), hiddenAt[3])
    await ev(2); assert.equal((await layout()).filter(t => t.hidden).map(t => `${t.word}`).join(','), hiddenAt[4])
    await ev(0)                                                           // tap → section 2
    assert.equal((await state()).section, 1); assert.match(await text('#lessonStatus'), /المقطع ٢\/٣/)
  })

  await check('Recall forward/back via SDK events; phone count follows; stage 7 → recall switches panel to تسطير', async () => {
    while ((await state()).stage < 7) await ev(2)
    await ev(2)                                                           // past stage 7 → recall
    let s = await state(); assert.equal(s.phase, 'recall'); assert.equal(s.activity, 'lesson')
    assert.ok(await p.$eval('#tasteerPanel', e => e.classList.contains('active')))
    for (let i = 1; i <= 3; i++) { await ev(2); assert.match(await text('#tasteerStatus'), new RegExp(`ظهرت ${String.fromCharCode(0x660 + i)} من`)) }
    await ev(1); s = await state(); assert.equal(s.recallIndex, 1)
    assert.match(await text('#tasteerStatus'), /ظهرت ٢ من/)
    await ev(1); await ev(1); await ev(1)                                 // back to stage 7 (دروس rule)
    s = await state(); assert.equal(s.phase, 'memo'); assert.equal(s.stage, 7)
    assert.ok(await p.$eval('#lessonPanel', e => e.classList.contains('active')))
  })

  await check('Switching activities starts fresh state; Reading Mode / page jump / End leave the activity cleanly', async () => {
    await click('#btnStartTasteer')
    let s = await state(); assert.equal(s.activity, 'tasteer'); assert.equal(s.recallIndex, -1); assert.equal(s.section, 0)
    await ev(2); await ev(2)
    const seed1 = s.seed
    await click('#btnStartLesson')
    s = await state(); assert.equal(s.activity, 'lesson'); assert.equal(s.stage, 0); assert.equal(s.recallIndex, -1)
    assert.notEqual(s.seed, seed1)
    assert.ok(!(await p.$eval('#tasteerPanel', e => e.classList.contains('active'))))
    // Phone auto-advance Reading Mode ends the activity explicitly
    await click('#btnReadingMode')
    assert.equal(await app.eval(() => window.noor.mode), 'reading'); assert.equal(await state(), null)
    assert.ok(!(await p.$eval('#lessonPanel', e => e.classList.contains('active'))))
    await p.click('#btnReadingMode')                                      // stop auto-advance
    // Selecting a page during an activity returns to Reading at that page
    await click('#btnStartTasteer'); await selectPage(100)
    assert.equal(await app.eval(() => window.noor.mode), 'reading'); assert.equal(await app.eval(() => window.noor.page), 100)
    assert.ok(!(await p.$eval('#tasteerPanel', e => e.classList.contains('active'))))
    // End button
    await click('#btnStartLesson'); await click('#lessonPanel .btn-act-end')
    assert.equal(await app.eval(() => window.noor.mode), 'reading'); assert.equal(await state(), null)
    // Auto-advance cannot move the page under an active session
    await click('#btnStartLesson'); const before = await app.eval(() => window.noor.page)
    await app.eval(() => window.noor.nextScreen()); assert.equal(await app.eval(() => window.noor.page), before)
    assert.equal(await app.eval(() => window.noor.mode), 'memo')
  })

  await check('تسطير: back before the first word returns to Reading; double press keeps the exit popup', async () => {
    await click('#btnStartTasteer')
    await ev(1)
    assert.equal(await app.eval(() => window.noor.mode), 'reading')
    await click('#btnStartTasteer')
    await app.eval(() => { window.__calls = [] })
    await app.event(3); await wait(300)
    assert.ok((await app.eval(() => window.__calls)).includes('shutDownPageContainer'))
  })

  await check('Short pages and boundaries: sections wrap on pages 1, 2, 586, 590 and 604 in both activities', async () => {
    for (const [page, n] of [[1, 2], [2, 2], [586, 3], [590, 3], [604, 3]]) {
      await selectPage(page)
      for (const btn of ['#btnStartLesson', '#btnStartTasteer']) {
        await click(btn)
        const s = await state(); assert.equal(s.sectionCount, n, `page ${page}`)
        for (let i = 0; i < n; i++) await ev(0)
        assert.equal((await state()).section, 0, `page ${page}: tap did not wrap`)
      }
      // تسطير to the end of the page: every word revealed, last section shown
      await app.render(() => { for (let i = 0; i < 400; i++) window.noor.memo.advance() })
      const s = await state(); assert.equal(s.recallIndex, s.words - 1); assert.equal(s.section, n - 1)
      assert.ok((await layout()).every(t => !t.hidden))
    }
  })

  await check('Reading Mode unaffected: after ending an activity the G2 shows exactly the Reading render', async () => {
    await selectPage(77)
    const reading = await app.settle(40)
    await click('#btnStartLesson'); await ev(2)
    await click('#lessonPanel .btn-act-end')
    const again = await app.settle(40)
    for (let t = 0; t < 4; t++) assert.ok(reading[t].equals(again[t]), `tile ${t + 1} differs`)
  })

  await app.close()
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall phone e2e checks passed')
  process.exit(failures ? 1 : 0)
})()
