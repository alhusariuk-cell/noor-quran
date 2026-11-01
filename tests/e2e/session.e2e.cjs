/**
 * M1.3 session continuity: save, interrupt, restore — end to end.
 *
 *   node --no-warnings tests/e2e/session.e2e.cjs <dist built with NOOR_APP_ID=com.noor.quran.fullscreen.test>
 *
 * The mock host keeps bridge storage in Node (survives reloads; can fail, be
 * empty, or answer slowly), and WebView localStorage survives reloads of the
 * same browser. A new browser with the same bridge store = lost WebView storage.
 * Every restore must give the identical state, byte-identical G2 tiles, and the
 * same next forward/backward step as the model.
 * Software verification only — not a substitute for physical G2 testing.
 */
const { openApp } = require('./harness.cjs')
const assert = require('assert')

const dist = process.argv[2]
const wait = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, fn) => fn().then(
  () => console.log(`ok   - ${name}`),
  e => { failures++; console.log(`FAIL - ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`) })

;(async () => {
  const M = await import('../../src/memorisation.ts')
  const { MUSHAF_DATA } = await import('../../src/mushaf-bundle.ts')
  const getLines = p => MUSHAF_DATA[p] && MUSHAF_DATA[p].lines
  const APP = 'com.noor.quran.fullscreen.test'
  const model = (pageNum, seed) => { const page = M.buildMemoPage(getLines(pageNum)); return M.startFlow(page, M.buildExercises(getLines, page, pageNum), seed, 0) }
  const keyOf = f => f === 'exit' ? 'exit' : `${f.phase}|k${f.k}|s${f.stage}|i${f.index}|v${f.section}`

  const bridge = { store: {}, mode: 'ok', delayMs: 0 }
  let app = await openApp(dist, { bridge, offline: true })
  const pageErrors = []
  const hookErrors = a => a.page.on('pageerror', e => pageErrors.push(String(e)))
  hookErrors(app)
  const keys = await app.eval(() => window.noor.sessionKeys)
  assert.equal(keys.main, `${APP}:memo.session.v1`)

  // ── helpers ──────────────────────────────────────────────────────────────────
  const st = () => app.eval(() => window.noor.memo.state)
  const stKey = s => `${s.phase}|k${s.k}|s${s.stage}|i${s.index}|v${s.section}`
  const idle = () => app.page.waitForFunction(() => window.noor.bridgeIdle, null, { timeout: 10000 })
  const local = async k => { const v = await app.eval(k => localStorage.getItem(k), k); return v ? JSON.parse(v) : null }
  const fromBridge = k => bridge.store[k] ? JSON.parse(bridge.store[k]) : null
  const start = async (page, seed) => {
    await app.render(p => window.noor.jumpToPage(p), page)
    await app.render(s => window.noor.startLesson(s), seed)
  }
  /** Advance with test hooks until the session matches `t` ({phase, k?, stage?, index?}). */
  const reach = async t => {
    await app.eval(t => {
      for (let g = 0; g < 3000; g++) {
        const s = window.noor.memo.state
        if (s.phase === t.phase && (t.k === undefined || s.k === t.k) && (t.stage === undefined || s.stage === t.stage) &&
            (t.index === undefined || s.index === t.index)) return
        window.noor.memo.advance()
      }
      throw new Error('target not reached ' + JSON.stringify(t))
    }, t)
    await app.settle(60)          // no render happens when the target is already the current state
  }
  /** Capture what must be reproduced exactly. */
  // Force a fresh render first: after rapid steps the existing render queue can leave the
  // display one render behind until its 8 s heartbeat (pre-existing; reported, not changed here).
  const capture = async () => {
    await app.render(() => window.noor.memo.redraw())
    return { state: await st(), tiles: await app.settle(40), page: await app.eval(() => window.noor.page) }
  }
  const sameTiles = (a, b, where) => { for (let i = 0; i < 4; i++) assert.ok(a[i].equals(b[i]), `${where}: tile ${i + 1} differs`) }
  /** Phone: the saved-lesson card is offered; press متابعة الدرس. */
  const resumeViaPhone = async () => {
    assert.equal(await app.eval(() => window.noor.mode), 'reading', 'should start in Reading Mode')
    await app.page.waitForFunction(() => window.noor.sessionLoaded)
    await app.page.waitForFunction(() => !document.getElementById('lessonSaved').hidden, null, { timeout: 5000 })
    const b = await app.eval(() => window.__sends)
    await app.page.click('#btnResumeLesson')
    await app.page.waitForFunction(b => window.__sends >= b + 4, b)
    return capture()
  }
  /** After restore: identical state, tiles, and next forward/back steps vs the model. */
  const assertRestored = async (before, after, where) => {
    assert.equal(after.page, before.page, `${where}: page`)
    assert.equal(stKey(after.state), stKey(before.state), `${where}: state`)
    assert.equal(after.state.seed, before.state.seed, `${where}: seed`)
    sameTiles(before.tiles, after.tiles, where)
    let f = model(before.page, before.state.seed)
    for (let g = 0; g < 3000 && keyOf(f) !== stKey(before.state); g++) f = M.flowAdvance(f)
    assert.equal(keyOf(f), stKey(before.state), `${where}: model did not reach the state`)
    const lay = await app.eval(() => window.noor.memo.layout())
    for (const t of lay) if (t.role === 'word') assert.equal(t.hidden, M.flowHidden(f, t.word), `${where}: word ${t.word}`)
    const pv = await app.eval(() => window.noor.memo.previewLayout())
    if (pv) for (const t of pv) if (t.role === 'word') assert.equal(t.hidden, M.flowHidden(f, t.word), `${where}: preview word ${t.word}`)
    await app.render(() => window.noor.memo.advance())
    const fwd = M.flowAdvance(f)
    assert.equal(stKey(await st()), keyOf(fwd), `${where}: forward step`)
    await app.render(() => window.noor.memo.back())
    assert.equal(stKey(await st()), stKey(before.state), `${where}: backward step`)
    const back = M.flowBack(f)
    if (back !== 'exit') {
      await app.render(() => window.noor.memo.back())
      assert.equal(stKey(await st()), keyOf(back), `${where}: backward from restored state`)
      await app.render(() => window.noor.memo.advance())
    }
  }
  const interruptReload = async () => { await idle(); await app.reload() }
  const freshBrowserBridgeOnly = async () => {          // WebView storage lost; bridge storage kept
    await idle(); await app.close()
    app = await openApp(dist, { bridge, offline: true }); hookErrors(app)
  }
  const sign = c => ({ ...c, sum: M.checkpointSum(c) })

  // ── 1–4, 7: stages 0/4/7, section recall, DONE, next-section transition (WebView reload) ──
  await check('Interrupt by WebView reload at stages 0, 4, 7, section تسطير, DONE and next section: exact restore', async () => {
    for (const [label, t] of [['stage 0', { phase: 'memo', k: 0, stage: 0 }], ['stage 4', { phase: 'memo', k: 0, stage: 4 }],
      ['stage 7', { phase: 'memo', k: 0, stage: 7 }], ['section recall', { phase: 'recall', k: 0, index: 17 }],
      ['section DONE', { phase: 'done', k: 0 }], ['next section stage 0', { phase: 'memo', k: 1, stage: 0 }],
      ['section 2 recall into preview', { phase: 'recall', k: 1, index: 55 }]]) {
      await start(50, 4242); await reach(t)
      const before = await capture()
      await interruptReload()
      const after = await resumeViaPhone()
      await assertRestored(before, after, label)
    }
  })

  // ── 5, 9: final whole-page recall restored from bridge storage only ───────────
  await check('Final whole-page تسطير: WebView storage lost, restored from bridge storage', async () => {
    await start(50, 7); await reach({ phase: 'final', index: 60 })
    const before = await capture()
    await freshBrowserBridgeOnly()
    assert.equal(await app.eval(k => localStorage.getItem(k), keys.main), null)   // localStorage really empty
    const after = await resumeViaPhone()
    await assertRestored(before, after, 'final (bridge only)')
  })

  // ── 6: COMPLETE ──────────────────────────────────────────────────────────────
  await check('COMPLETE: completion kept, no resume offered', async () => {
    await start(50, 9); await reach({ phase: 'complete' })
    await interruptReload()
    await app.page.waitForFunction(() => window.noor.sessionLoaded)
    assert.equal(await app.eval(() => window.noor.mode), 'reading')
    assert.ok(await app.page.isHidden('#lessonSaved'))
    assert.match(await app.page.textContent('#lessonCompleteNote'), /✓ أُكمل درس الصفحة ٥٠/)
    assert.equal(await app.eval(() => window.noor.resumeLesson()), false)
    assert.equal((await app.eval(() => window.noor.saved)).complete, true)
  })

  // ── 8: bridge failing / empty → localStorage ─────────────────────────────────
  await check('Bridge storage failing or empty: restored from localStorage', async () => {
    bridge.mode = 'fail'
    await start(586, 31); await reach({ phase: 'recall', k: 2, index: 3 })
    const before = await capture()
    bridge.mode = 'empty'
    await interruptReload()
    const after = await resumeViaPhone()
    await assertRestored(before, after, 'bridge failing')
    bridge.mode = 'ok'
  })

  // ── 10: corrupt / incompatible data ──────────────────────────────────────────
  await check('Corrupt JSON, invalid index, other schema / algorithm / app: Reading Mode, notice, quarantined, no crash', async () => {
    await start(50, 1); await reach({ phase: 'recall', k: 0, index: 5 })
    // End the lesson first: a live lesson is (correctly) flushed on pagehide during the reload,
    // which would overwrite the injected data
    await app.render(() => window.noor.endActivity()); await idle()
    const good = await local(keys.main)
    const variants = {
      'corrupt JSON': '{"v":1,"alg":1,"pag',
      'invalid index': JSON.stringify(sign({ ...good, index: 999 })),
      'schema 2': JSON.stringify(sign({ ...good, v: 2 })),
      'algorithm 2': JSON.stringify(sign({ ...good, alg: 2 })),
      'other app': JSON.stringify(sign({ ...good, app: 'com.noor.quran' })),
      'checksum': JSON.stringify({ ...good, stage: 3 }),
    }
    for (const [name, raw] of Object.entries(variants)) {
      await app.eval(([k, v]) => localStorage.setItem(k, v), [keys.main, raw]); bridge.store[keys.main] = raw
      const errs = pageErrors.length
      await app.reload(); await app.page.waitForFunction(() => window.noor.sessionLoaded)
      assert.equal(await app.eval(() => window.noor.mode), 'reading', name)
      assert.equal(await app.eval(() => window.noor.saved), null, name)
      assert.ok(await app.eval(() => window.noor.savedInvalid), `${name}: no reason`)
      assert.ok(await app.page.isVisible('#lessonInvalidNote'), `${name}: no notice`)
      await idle()
      const q = JSON.parse(await app.eval(k => localStorage.getItem(k), keys.invalid))
      assert.equal(q.raw, raw, `${name}: not quarantined`)
      assert.equal(JSON.parse(bridge.store[keys.invalid]).raw, raw)
      assert.equal(await app.eval(k => localStorage.getItem(k), keys.main), raw, `${name}: original discarded`)
      assert.equal(pageErrors.length, errs, `${name}: page error ${pageErrors.slice(-1)}`)
    }
    // One store corrupt, the other valid → the valid one is used, no notice
    await app.eval(([k, v]) => localStorage.setItem(k, v), [keys.main, JSON.stringify(good)]); bridge.store[keys.main] = '{broken'
    await app.reload(); await app.page.waitForFunction(() => window.noor.sessionLoaded)
    assert.equal((await app.eval(() => window.noor.saved)).rev, good.rev)
    assert.equal(await app.eval(() => window.noor.savedInvalid), null)
  })

  await check('Newest valid revision wins between the two stores; an older store never overwrites it', async () => {
    await start(50, 21); await reach({ phase: 'memo', k: 0, stage: 3 }); await idle()
    const older = await local(keys.main)
    await reach({ phase: 'recall', k: 0, index: 9 })
    const before = await capture(); await idle()
    const newer = await local(keys.main)
    assert.ok(newer.rev > older.rev)
    // localStorage holds the older lesson, bridge the newer
    await app.eval(([k, v]) => localStorage.setItem(k, v), [keys.main, JSON.stringify(older)])
    await app.reload()
    const after = await resumeViaPhone()
    await assertRestored(before, after, 'newer from bridge')
    await idle()
    assert.ok((await local(keys.main)).rev > newer.rev); assert.ok(fromBridge(keys.main).rev > newer.rev)
  })

  // ── 11: new lesson confirmation and backup recovery ──────────────────────────
  await check('بدء درس جديد asks for confirmation; the replaced lesson is kept and can be recovered exactly', async () => {
    await start(50, 1111); await reach({ phase: 'recall', k: 0, index: 12 })
    const A = await capture()
    await app.page.click('#lessonPanel .act-status .btn-act-end')            // إنهاء الدرس
    await app.settle(40)
    assert.equal(await app.eval(() => window.noor.mode), 'reading')
    assert.ok(await app.page.isVisible('#lessonSaved'))
    const savedA = await app.eval(() => window.noor.saved)
    // Cancel keeps everything
    await app.page.click('#btnNewLesson')
    assert.ok(await app.page.isVisible('#lessonConfirmModal'))
    assert.match(await app.page.textContent('#lessonConfirmText'), /سيُستبدل الدرس المحفوظ/)
    await app.page.click('#btnCancelNewLesson')
    assert.ok(await app.page.isHidden('#lessonConfirmModal'))
    assert.equal(await app.eval(() => window.noor.mode), 'reading')
    assert.equal((await app.eval(() => window.noor.saved)).rev, savedA.rev)
    // Confirm starts a new lesson; A becomes the backup
    await app.page.click('#btnNewLesson'); await app.page.click('#btnConfirmNewLesson'); await app.settle(40)
    const s = await st(); assert.equal(s.phase, 'memo'); assert.equal(s.stage, 0); assert.notEqual(s.seed, A.state.seed)
    assert.equal((await app.eval(() => window.noor.savedPrev)).seed, A.state.seed)
    await app.render(() => window.noor.memo.advance())                    // new lesson at stage 1
    const B = await st()
    await interruptReload(); await app.page.waitForFunction(() => window.noor.sessionLoaded)
    assert.ok(await app.page.isVisible('#lessonPrevNote'))
    const b = await app.eval(() => window.__sends)
    await app.page.click('#btnRecoverPrev'); await app.page.waitForFunction(b => window.__sends >= b + 4, b)
    const after = await capture()
    await assertRestored(A, after, 'recovered backup')
    assert.equal((await app.eval(() => window.noor.savedPrev)).seed, B.seed)   // the new lesson is now the backup
  })

  // ── 12: standalone تسطير isolation ────────────────────────────────────────────
  await check('Standalone تسطير never changes the saved lesson', async () => {
    await start(50, 55); await reach({ phase: 'recall', k: 0, index: 4 })
    await app.render(() => window.noor.endActivity()); await idle()
    const saved = await app.eval(k => localStorage.getItem(k), keys.main), savedBridge = bridge.store[keys.main]
    await app.render(() => document.getElementById('btnStartTasteer').click())
    for (let i = 0; i < 5; i++) await app.render(() => window.noor.memo.advance())
    await app.render(() => window.noor.endActivity()); await idle()
    assert.equal(await app.eval(k => localStorage.getItem(k), keys.main), saved)
    assert.equal(bridge.store[keys.main], savedBridge)
    // Switching to تسطير during a live lesson pauses it at the same position
    await app.render(() => window.noor.resumeLesson()); const pos = await st()
    await app.render(() => window.noor.startTasteer(1)); await idle()
    const cp = await local(keys.main)
    assert.deepEqual([cp.phase, cp.k, cp.stage, cp.index, cp.active], [pos.phase, pos.k, pos.stage, pos.index, false])
  })

  // ── 13: rapid input and write ordering ───────────────────────────────────────
  await check('Rapid steps with slow, variable bridge writes: final stored state is the newest, writes in order', async () => {
    bridge.delayMs = () => Math.floor(Math.random() * 40); bridge.log = []
    await start(50, 77)
    await app.eval(() => { for (let i = 0; i < 150; i++) window.noor.memo.advance() })
    await idle(); await app.settle(40)
    const s = await st(), lc = await local(keys.main), bc = fromBridge(keys.main)
    assert.equal(lc.rev, bc.rev); assert.deepEqual([bc.phase, bc.k, bc.stage, bc.index], [s.phase, s.k, s.stage, s.index])
    const revs = bridge.log.filter(([k]) => k === keys.main).map(([, v]) => JSON.parse(v).rev)
    revs.forEach((r, i) => assert.ok(i === 0 || r > revs[i - 1], `bridge write ${i} out of order`))
    console.log(`       150 steps → ${revs.length} coalesced bridge writes, all in increasing revision order`)
    // Burst of real SDK swipes: checkpoint matches the state after the burst
    for (let i = 0; i < 6; i++) { await app.event(2); await wait(140) }
    await wait(900); await idle(); await app.settle(40)
    const s2 = await st(), c2 = fromBridge(keys.main)
    assert.deepEqual([c2.phase, c2.k, c2.stage, c2.index], [s2.phase, s2.k, s2.stage, s2.index])
    bridge.delayMs = 0; bridge.log = null
  })

  // ── 14: repeated launch and resume ───────────────────────────────────────────
  await check('Repeated launch → resume → continue (3 cycles) stays exact', async () => {
    await start(302, 303)
    let f = model(302, 303)
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 23; i++) { f = M.flowAdvance(f); await app.eval(() => window.noor.memo.advance()) }
      const before = await capture()
      assert.equal(stKey(before.state), keyOf(f))
      await interruptReload()
      const after = await resumeViaPhone()
      assert.equal(stKey(after.state), keyOf(f)); sameTiles(before.tiles, after.tiles, `cycle ${cycle}`)
    }
  })

  // ── 15: pages 1, 50, 586, 590, 604 ───────────────────────────────────────────
  await check('Pages 1, 50, 586, 590, 604: last-section DONE and final تسطير restore exactly', async () => {
    for (const pg of [1, 50, 586, 590, 604]) {
      const K = model(pg, 1).exercises.length
      for (const t of [{ phase: 'done', k: K - 1 }, { phase: 'final', index: 20 }]) {
        await start(pg, 600 + pg); await reach(t)
        const before = await capture()
        await interruptReload()
        const after = await resumeViaPhone()
        await assertRestored(before, after, `page ${pg} ${t.phase}`)
      }
    }
  })

  // ── Lifecycle: exit events, pagehide, G2 disconnect / reconnect, "No, Stay" ──
  await check('Lifecycle events 5/6/7, pagehide and G2 disconnect flush the same position; reconnect re-renders; No, Stay restores', async () => {
    await start(50, 99); await reach({ phase: 'recall', k: 1, index: 7 }); await idle()
    const pos = await st()
    for (const ev of [5, 6, 7]) {
      const r0 = (await local(keys.main)).rev
      await app.event(ev); await wait(150)
      const c = await local(keys.main)
      assert.ok(c.rev > r0, `event ${ev} did not flush`)
      assert.deepEqual([c.phase, c.k, c.stage, c.index], [pos.phase, pos.k, pos.stage, pos.index])
    }
    let r0 = (await local(keys.main)).rev
    await app.eval(() => window.dispatchEvent(new Event('pagehide')))
    assert.ok((await local(keys.main)).rev > r0, 'pagehide did not flush')
    r0 = (await local(keys.main)).rev
    await app.eval(() => window._listenEvenAppMessage({ type: 'listen_even_app_data', method: 'deviceStatusChanged', data: { sn: 'G2', connectType: 'disconnected' } }))
    await wait(150)
    assert.ok((await local(keys.main)).rev > r0, 'G2 disconnect did not flush')
    const b = await app.eval(() => window.__sends)
    await app.eval(() => window._listenEvenAppMessage({ type: 'listen_even_app_data', method: 'deviceStatusChanged', data: { sn: 'G2', connectType: 'connected' } }))
    await app.page.waitForFunction(b => window.__sends >= b + 4, b, { timeout: 5000 })
    assert.equal(stKey(await st()), stKey(pos))                             // reconnect: same lesson re-rendered
    // Double press → exit dialog → "No, Stay" (reloads the WebView) → resume is exact
    const before = await capture(); await idle()
    await app.event(3); await wait(300)
    await Promise.all([app.page.waitForEvent('load'), app.eval(() => cancelExit())])
    await app.waitReady()
    const after = await resumeViaPhone()
    await assertRestored(before, after, 'No, Stay')
  })

  await app.close()
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall session e2e checks passed')
  process.exit(failures ? 1 : 0)
})()
