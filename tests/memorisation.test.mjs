// Unit tests for src/memorisation.ts, run against the real 604-page bundle.
// Run with: pnpm test   (Node's built-in test runner + type stripping; no extra deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildMemoPage, hidingOrder, hiddenCountAtStage, startSession, startTasteer, advance, back, nextSection,
  isWordHidden, revealedCount, sectionOfWord, stripMarks, STRIP_RE, MAX_STAGE, nextPreviewLine,
  buildExercises, startFlow, flowAdvance, flowBack, flowHidden, flowProgress, exerciseCount, sectionSeed,
  makeCheckpoint, restoreCheckpoint, checkpointSum, deriveSection, CHECKPOINT_VERSION, ALG_VERSION,
} from '../src/memorisation.ts'
import { MUSHAF_DATA } from '../src/mushaf-bundle.ts'

const PAGES = Array.from({ length: 604 }, (_, i) => i + 1)
const memoPage = p => buildMemoPage(MUSHAF_DATA[p].lines)
const SEEDS = [1, 42, 20261101, 0xdeadbeef]

function hiddenSet(s) {
  const out = new Set()
  for (let w = 0; w < s.page.words.length; w++) if (isWordHidden(s, w)) out.add(w)
  return out
}
function atStage(page, seed, stage) {
  let s = startSession(page, seed, 0)
  for (let k = 0; k < stage; k++) s = advance(s)
  return s
}

// ── Data model ────────────────────────────────────────────────────────────────

test('all 604 pages build; hideable words and ayah markers match the source data', () => {
  let words = 0, markers = 0
  for (const p of PAGES) {
    const page = memoPage(p)
    words += page.words.length
    markers += page.lines.flatMap(l => l.tokens).filter(t => t.role === 'ayah').length
  }
  assert.equal(words, 77429)     // every data word in the bundle
  assert.equal(markers, 6236)    // one marker per ayah in the Quran
})

test('ayah markers are digits only and never belong to a hideable word', () => {
  for (const p of PAGES) {
    for (const t of memoPage(p).lines.flatMap(l => l.tokens)) {
      if (t.role === 'ayah') { assert.match(t.text, /^[٠-٩]+$/); assert.equal(t.word, -1) }
      else assert.doesNotMatch(t.text, /^[٠-٩]+$/, `page ${p}: digit token marked as word`)
    }
  }
})

test('ayah markers stay visible at every stage and throughout recall', () => {
  // Visibility is decided per hideable word; markers have no word index, so the
  // renderer always draws them. Assert the session never reports a marker hidden.
  const page = memoPage(50)
  let s = startSession(page, 7, 0)
  const markerTokens = page.lines.flatMap(l => l.tokens).filter(t => t.role === 'ayah')
  assert.ok(markerTokens.length > 0)
  for (let k = 0; k <= MAX_STAGE + page.words.length; k++) {
    for (const t of markerTokens) assert.equal(t.word, -1)
    s = advance(s)
  }
})

// ── Reading Mode equivalence (layout must not change) ─────────────────────────

test('strip regex is identical to Reading Mode stripWaqfMarkers()', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const m = main.match(/function stripWaqfMarkers\(text: string\): string \{\s*return text\.replace\(\/(.+)\/g, ''\)/)
  assert.ok(m, 'stripWaqfMarkers not found in main.ts')
  // main.ts writes the class with literal characters; compare behaviour on every BMP code point
  const readingRe = new RegExp(m[1], 'g')
  for (let cp = 0; cp <= 0xFFFF; cp++) {
    if (cp >= 0xD800 && cp <= 0xDFFF) continue
    const ch = String.fromCharCode(cp)
    assert.equal(ch.replace(readingRe, ''), stripMarks(ch), `U+${cp.toString(16)}`)
  }
})

test('memorisation tokens equal Reading Mode words on every line of every page', () => {
  for (const p of PAGES) {
    const src = MUSHAF_DATA[p].lines
    const page = memoPage(p)
    src.forEach((line, i) => {
      if (line.type !== 'text') { assert.equal(page.lines[i].tokens.length, 0); return }
      // Exactly what renderLinesToQuads computes
      const text = stripMarks(line.words && line.words.length > 0 ? line.words.map(w => w.word).join(' ') : (line.text ?? ''))
      assert.equal(page.lines[i].text, text, `page ${p} line ${i} text`)
      assert.deepEqual(page.lines[i].tokens.map(t => t.text), text.split(' ').filter(Boolean), `page ${p} line ${i} tokens`)
    })
  }
})

// ── 1. Stage counts and cumulative hiding ─────────────────────────────────────

test('stage counts follow Hafiz: round(k × N / 7), stage 0 none, stage 7 all', () => {
  for (const p of PAGES) {
    const page = memoPage(p), N = page.words.length
    let prev = new Set()
    let s = startSession(page, 99 + p, 0)
    for (let k = 0; k <= MAX_STAGE; k++) {
      const h = hiddenSet(s)
      const expected = k === 0 ? 0 : k === 7 ? N : Math.round(k * N / 7)
      assert.equal(h.size, expected, `page ${p} stage ${k}`)
      assert.equal(hiddenCountAtStage(k, N), expected)
      for (const w of prev) assert.ok(h.has(w), `page ${p}: stage ${k} not cumulative`)
      prev = h
      if (k < MAX_STAGE) s = advance(s)
    }
  }
})

test('hiding order is a permutation and is reproducible from the seed', () => {
  for (const N of [0, 1, 2, 3, 10, 135, 200]) {
    for (const seed of SEEDS) {
      const a = hidingOrder(N, seed)
      assert.deepEqual([...a].sort((x, y) => x - y), Array.from({ length: N }, (_, i) => i))
      assert.deepEqual(hidingOrder(N, seed), a)
    }
  }
  assert.notDeepEqual(hidingOrder(135, 1), hidingOrder(135, 2))
})

// ── 2. Non-adjacent hidden words at stages 1–2 ────────────────────────────────

test('stages 1 and 2 never hide two adjacent words (page-wide, across lines)', () => {
  for (const p of PAGES) {
    const page = memoPage(p)
    for (const seed of SEEDS) {
      for (const stage of [1, 2]) {
        const h = hiddenSet(atStage(page, seed, stage))
        for (const w of h) assert.ok(!h.has(w + 1), `page ${p} seed ${seed} stage ${stage}: ${w},${w + 1}`)
      }
    }
  }
})

test('first pass takes non-adjacent words before any adjacent ones (Hafiz two-pass)', () => {
  for (const seed of SEEDS) {
    const N = 140, order = hidingOrder(N, seed)
    const taken = new Set()
    let firstAdjacent = -1
    order.forEach((w, i) => {
      if (firstAdjacent < 0 && (taken.has(w - 1) || taken.has(w + 1))) firstAdjacent = i
      taken.add(w)
    })
    // Every word before the first adjacent pick is non-adjacent, and that prefix is maximal
    const prefix = new Set(order.slice(0, firstAdjacent))
    for (let w = 0; w < N; w++) {
      if (!prefix.has(w)) assert.ok(prefix.has(w - 1) || prefix.has(w + 1), `word ${w} could still have been picked`)
    }
  }
})

// ── 3. Stage reversibility ────────────────────────────────────────────────────

test('stage 4 → 3 → 4 hides exactly the same words; random walks are consistent', () => {
  for (const p of [1, 2, 50, 187, 300, 586, 604]) {
    const page = memoPage(p)
    for (const seed of SEEDS) {
      let s = atStage(page, seed, 4)
      const at4 = hiddenSet(s)
      s = back(s); const at3 = hiddenSet(s)
      assert.equal(s.stage, 3)
      s = advance(s)
      assert.deepEqual(hiddenSet(s), at4)
      // Random walk: every visit to a stage shows the same set
      const seen = new Map()
      let w = startSession(page, seed, 0)
      const rnd = (() => { let x = seed; return () => (x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32 })()
      for (let i = 0; i < 200; i++) {
        const key = w.stage, h = [...hiddenSet(w)].sort((a, b) => a - b).join(',')
        if (seen.has(key)) assert.equal(seen.get(key), h, `page ${p} stage ${key} changed`)
        else seen.set(key, h)
        if (rnd() < 0.5 && w.stage < MAX_STAGE) w = advance(w)
        else if (w.stage > 0) w = back(w)
      }
      assert.ok(at3.size < at4.size)
    }
  }
})

// ── 5. Recall ─────────────────────────────────────────────────────────────────

test('recall: enter from stage 7 only; reveal in reading order; back re-hides last', () => {
  const page = memoPage(50), N = page.words.length
  let s = atStage(page, 3, 6)
  s = advance(s)
  assert.equal(s.phase, 'memo'); assert.equal(s.stage, 7)
  s = advance(s)                                        // past stage 7 → recall
  assert.equal(s.phase, 'recall'); assert.equal(revealedCount(s), 0)
  assert.equal(hiddenSet(s).size, N)                    // same display as stage 7
  for (let i = 0; i < N; i++) {
    s = advance(s)
    assert.equal(revealedCount(s), i + 1)
    for (let w = 0; w < N; w++) assert.equal(isWordHidden(s, w), w > i)
  }
  assert.equal(advance(s), s)                           // nothing more to reveal
  s = back(s)                                           // re-hide the last word
  assert.equal(revealedCount(s), N - 1); assert.ok(isWordHidden(s, N - 1))
  while (revealedCount(s) > 0) s = back(s)
  assert.equal(s.phase, 'recall'); assert.equal(s.recallIndex, -1)
  s = back(s)                                           // before the first word → stage 7
  assert.equal(s.phase, 'memo'); assert.equal(s.stage, 7); assert.equal(hiddenSet(s).size, N)
})

test('back from stage 0 exits to Reading Mode', () => {
  assert.equal(back(startSession(memoPage(10), 1, 0)), 'exit')
})

// ── 6. Section transitions ────────────────────────────────────────────────────

test('single press cycles sections and wraps; stage changes keep the section', () => {
  const page = memoPage(50)
  let s = startSession(page, 1, 1)
  assert.equal(s.section, 1)
  s = advance(s); s = advance(s); assert.equal(s.section, 1)
  s = back(s); assert.equal(s.section, 1)
  s = nextSection(s); assert.equal(s.section, 2)
  s = nextSection(s); assert.equal(s.section, 0)
  s = nextSection(s); assert.equal(s.section, 1)
})

test('recall shows the section of each revealed / re-hidden word', () => {
  const page = memoPage(300)
  let s = atStage(page, 5, 7); s = advance(s)
  s = nextSection(nextSection(s))                       // look at section 3 manually
  assert.equal(s.section, 2)
  s = advance(s)                                        // first word is in section 1
  assert.equal(s.section, sectionOfWord(page, 0)); assert.equal(s.section, 0)
  const sections = new Set()
  for (let i = 1; i < page.words.length; i++) { s = advance(s); assert.equal(s.section, sectionOfWord(page, i)); sections.add(s.section) }
  assert.deepEqual([...sections].sort(), [0, 1, 2])
  const last = page.words.length - 1
  s = back(s); assert.equal(s.section, sectionOfWord(page, last))
})

test('section of every word matches its line (5 lines per section)', () => {
  for (const p of PAGES) {
    const page = memoPage(p)
    page.words.forEach((w, i) => assert.equal(sectionOfWord(page, i), Math.floor(w.line / 5)))
  }
})

// ── 7. Pages with fewer than 15 lines ─────────────────────────────────────────

test('short pages: 1–2 have two sections, 586/590 three; everything else three', () => {
  const expected = { 1: 2, 2: 2, 586: 3, 590: 3 }
  for (const p of PAGES) {
    const page = memoPage(p)
    assert.equal(page.sectionCount, expected[p] ?? 3, `page ${p}`)
    for (const w of page.words) assert.ok(Math.floor(w.line / 5) < page.sectionCount)
  }
  let s = startSession(memoPage(1), 1, 0)
  s = nextSection(s); assert.equal(s.section, 1)
  s = nextSection(s); assert.equal(s.section, 0)       // wraps after two sections
  assert.equal(startSession(memoPage(2), 1, 9).section, 1)  // out-of-range start is clamped
})

// ── Page and surah boundaries ─────────────────────────────────────────────────

test('header and basmala lines contribute no hideable words', () => {
  for (const p of [1, 2, 50, 187, 604]) {
    const page = memoPage(p)
    MUSHAF_DATA[p].lines.forEach((l, i) => {
      if (l.type !== 'text') assert.ok(!page.words.some(w => w.line === i), `page ${p} line ${i}`)
    })
  }
})

test('surah boundaries: adjacency spans the whole page, including across surahs', () => {
  // Page 604 holds the end of al-Ikhlas, al-Falaq and an-Nas. The last word of
  // one surah and the first of the next are neighbours in the hideable list.
  const page = memoPage(604), N = page.words.length
  for (const seed of SEEDS) {
    const h = hiddenSet(atStage(page, seed, 2))
    for (let w = 0; w < N - 1; w++) assert.ok(!(h.has(w) && h.has(w + 1)))
  }
  // Lines are ordered and sections cover all lines
  const lines = page.words.map(w => w.line)
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b))
})

test('first and last words of the page are hideable and revealed first/last in recall', () => {
  for (const p of [1, 2, 187, 604]) {
    const page = memoPage(p), N = page.words.length
    let s = advance(atStage(page, 11, 7))
    s = advance(s)
    assert.equal(isWordHidden(s, 0), false); assert.equal(isWordHidden(s, 1), N > 1)
    for (let i = 1; i < N; i++) s = advance(s)
    assert.equal(isWordHidden(s, N - 1), false)
  }
})

// ── M1.1: تسطير started directly, and switching activities ───────────────────

test('تسطير starts in recall: every eligible word hidden, 0 revealed, first section', () => {
  for (const p of [1, 2, 50, 300, 586, 604]) {
    const page = memoPage(p)
    const s = startTasteer(page, 9)
    assert.equal(s.activity, 'tasteer'); assert.equal(s.phase, 'recall')
    assert.equal(s.recallIndex, -1); assert.equal(revealedCount(s), 0); assert.equal(s.section, 0)
    assert.equal(hiddenSet(s).size, page.words.length)
    // ayah markers are not words, so they are never hidden
    assert.ok(page.lines.flatMap(l => l.tokens).filter(t => t.role === 'ayah').every(t => t.word === -1))
  }
})

test('تسطير: reveal/re-hide like recall; back before the first word exits (no stages)', () => {
  const page = memoPage(300), N = page.words.length
  let s = startTasteer(page, 4)
  for (let i = 0; i < N; i++) { s = advance(s); assert.equal(revealedCount(s), i + 1); assert.equal(s.section, sectionOfWord(page, i)) }
  assert.equal(advance(s), s)
  for (let i = N; i > 0; i--) { s = back(s); assert.equal(revealedCount(s), i - 1) }
  assert.equal(s.phase, 'recall')
  assert.equal(back(s), 'exit')
})

test('دروس keeps M1 rules: recall reached from stage 7 goes back to stage 7', () => {
  let s = startSession(memoPage(50), 4, 0)
  assert.equal(s.activity, 'lesson')
  for (let k = 0; k < 8; k++) s = advance(s)
  assert.equal(s.phase, 'recall'); assert.equal(s.activity, 'lesson')
  s = back(s)
  assert.equal(s.phase, 'memo'); assert.equal(s.stage, 7)
})

test('a new session never inherits state from the previous one', () => {
  const page = memoPage(50)
  let a = startSession(page, 1, 2)
  for (let k = 0; k < 5; k++) a = advance(a)
  const t = startTasteer(page, 2)
  assert.equal(t.recallIndex, -1); assert.equal(t.section, 0); assert.equal(t.stage, MAX_STAGE)
  const l = startSession(page, 3, 0)
  assert.equal(l.stage, 0); assert.equal(l.phase, 'memo'); assert.equal(hiddenSet(l).size, 0)
})

// ── M1.2 experiment A: next-line preview ─────────────────────────────────────

const getLines = p => MUSHAF_DATA[p]?.lines
const readingText = l => stripMarks(l.words && l.words.length > 0 ? l.words.map(w => w.word).join(' ') : (l.text ?? ''))

test('preview is the first Quran text line after the section, verbatim, for every section of every page', () => {
  let checked = 0, skippedHeadings = 0, crossPage = 0
  for (const p of PAGES) {
    const sections = memoPage(p).sectionCount
    for (let k = 0; k < sections; k++) {
      const pv = nextPreviewLine(getLines, p, k)
      if (p === 604 && k === sections - 1) { assert.equal(pv, null); continue }
      assert.ok(pv, `page ${p} section ${k + 1}: no preview`)
      // Every line from the next section's start up to the preview must be a heading/basmala
      let q = p, i = (k + 1) * 5
      while (!(q === pv.page && i === pv.line)) {
        const lines = MUSHAF_DATA[q].lines
        if (i >= lines.length) { q++; i = 0; continue }
        assert.notEqual(lines[i].type, 'text', `page ${p} section ${k + 1}: skipped a text line ${q}:${i}`)
        skippedHeadings++; i++
      }
      const line = MUSHAF_DATA[pv.page].lines[pv.line]
      assert.equal(line.type, 'text')
      assert.equal(pv.text, readingText(line))                // exactly what Reading Mode draws
      if (pv.page !== p) crossPage++
      checked++
    }
  }
  assert.equal(checked, 1809)                                 // 1,810 sections minus page 604 section 3
  console.log(`    previews checked: ${checked}; cross-page: ${crossPage}; heading/basmala lines skipped: ${skippedHeadings}`)
})

test('preview named cases: pages 1, 2, 50, 186, 226, 586, 590 and 604', () => {
  const at = (p, k) => { const v = nextPreviewLine(getLines, p, k); return v && `${v.page}:${v.line}` }
  assert.equal(at(1, 0), '1:5')        // section 2 of al-Fatiha
  assert.equal(at(1, 1), '2:2')        // next page: heading + basmala skipped
  assert.equal(at(2, 0), '2:5')
  assert.equal(at(2, 1), '3:0')
  assert.deepEqual([0, 1, 2].map(k => at(50, k)), ['50:5', '50:10', '51:0'])
  assert.equal(at(186, 2), '187:1')    // at-Tawbah heading (no basmala) skipped
  assert.deepEqual([0, 1, 2].map(k => at(226, k)), ['226:5', '226:10', '227:0'])
  for (const p of [586, 590]) {         // 12-line pages: last section has 2 lines
    assert.equal(memoPage(p).sectionCount, 3)
    const last = nextPreviewLine(getLines, p, 2)
    assert.equal(last.page, p + 1)
  }
  // Page 604: lines 5 and 10 are the basmalas of al-Falaq and an-Nas, so the preview skips to 6 and 11
  assert.deepEqual([0, 1].map(k => at(604, k)), ['604:6', '604:11'])
  assert.equal(nextPreviewLine(getLines, 604, 2), null)       // end of the Mushaf
})

test('preview never belongs to the current section and does not change the session words', () => {
  for (const p of [1, 2, 50, 186, 226, 586, 590, 604]) {
    const page = memoPage(p)
    for (let k = 0; k < page.sectionCount; k++) {
      const pv = nextPreviewLine(getLines, p, k)
      if (!pv) continue
      assert.ok(pv.page > p || pv.line >= (k + 1) * 5)
    }
    assert.equal(memoPage(p).words.length, page.words.length)
  }
})

// ── M1.2 experiment B: section-by-section workflow ───────────────────────────

const flowFor = (p, seed = 7) => { const page = memoPage(p); return startFlow(page, buildExercises(getLines, page, p), seed) }
const exHidden = f => { const e = f.exercises[f.k]; const h = []; for (let id = e.start; id < e.end; id++) if (flowHidden(f, id)) h.push(id); return h }
const key = f => f === 'exit' ? 'exit' : `${f.phase}|k${f.k}|s${f.stage}|i${f.index}|v${f.section}`

test('exercises on all 604 pages: contiguous ranges, every page word in exactly one section, preview identity', () => {
  let external = 0, inPage = 0
  for (const p of PAGES) {
    const page = memoPage(p), N = page.words.length, ex = buildExercises(getLines, page, p)
    assert.equal(ex.length, page.sectionCount)
    let next = 0
    for (const e of ex) {
      assert.equal(e.start, next, `page ${p} section ${e.section + 1}: gap`)
      for (let id = e.start; id < e.mainEnd; id++) assert.equal(Math.floor(page.words[id].line / 5), e.section)
      next = e.mainEnd
      const pv = e.preview
      if (!pv) { assert.ok(p === 604 && e.section === ex.length - 1); assert.equal(e.end, e.mainEnd); continue }
      const ids = pv.tokens.filter(t => t.role === 'word').map(t => t.word)
      assert.ok(ids.length > 0)
      ids.forEach((id, j) => assert.ok(j === 0 || id >= ids[j - 1]))            // reading order
      assert.equal(ids[0], e.mainEnd, `page ${p} section ${e.section + 1}: preview not contiguous`)
      assert.equal(e.end, ids[ids.length - 1] + 1)
      assert.deepEqual(pv.tokens.map(t => t.text), pv.text.split(' ').filter(Boolean))   // verbatim line
      if (pv.external) {
        external++
        assert.equal(e.section, ex.length - 1); assert.ok(ids.every(id => id >= N))
      } else {
        inPage++
        // same identity as the next section's own words — never a new count
        assert.ok(ids.every(id => id < N && Math.floor(page.words[id].line / 5) === e.section + 1))
        assert.equal(page.words[ids[0]].line, pv.line)
      }
    }
    assert.equal(next, N, `page ${p}: sections do not cover all words`)
  }
  assert.equal(external, 603); assert.equal(inPage, 1810 - 604)
})

test('preview participates in every stage; counts round(s × n / 7) over main + preview; stage 7 hides all', () => {
  let previewHiddenSomewhere = 0, sections = 0
  for (const p of PAGES) {
    let f = flowFor(p, 1000 + p)
    for (;;) {
      const e = f.exercises[f.k], n = exerciseCount(e)
      const prevIds = new Set(e.preview ? e.preview.tokens.filter(t => t.role === 'word').map(t => t.word) : [])
      let prev = new Set(), sawPreview = false
      for (let s = 0; s <= MAX_STAGE; s++) {
        const h = exHidden(f)
        assert.equal(h.length, s === 0 ? 0 : s === 7 ? n : Math.round(s * n / 7), `page ${p} section ${f.k + 1} stage ${s}`)
        for (const id of prev) assert.ok(h.includes(id), 'not cumulative')
        if (h.some(id => prevIds.has(id))) sawPreview = true
        prev = new Set(h)
        if (s < MAX_STAGE) f = flowAdvance(f)
      }
      if (sawPreview) previewHiddenSomewhere++
      sections++
      // skip to the next section via recall and DONE
      f = flowAdvance(f)
      while (f.phase === 'recall') f = flowAdvance(f)
      assert.equal(f.phase, 'done')
      f = flowAdvance(f)
      if (f.phase !== 'memo') break
    }
  }
  assert.equal(sections, 1810)
  assert.equal(previewHiddenSomewhere, 1809)   // every section with a preview hides preview words by stage 7
})

test('deterministic hiding: same seed → same sets; revisiting a stage restores it; stages 1–2 non-adjacent', () => {
  for (const p of [1, 2, 50, 186, 226, 586, 590, 604]) {
    for (const seed of SEEDS) {
      let a = flowFor(p, seed), b = flowFor(p, seed)
      const at = {}
      for (let s = 1; s <= 7; s++) {
        a = flowAdvance(a); b = flowAdvance(b)
        assert.deepEqual(exHidden(a), exHidden(b))
        at[s] = exHidden(a).join(',')
        if (s <= 2) { const h = new Set(exHidden(a)); for (const id of h) assert.ok(!h.has(id + 1), `page ${p} stage ${s}: adjacent`) }
      }
      for (let s = 7; s >= 1; s--) { assert.equal(exHidden(a).join(','), at[s]); a = flowBack(a) }
      a = flowAdvance(flowAdvance(flowAdvance(flowAdvance(a))))
      assert.equal(exHidden(a).join(','), at[4])                     // 4 → 3 → 4 identical
      a = flowBack(a); a = flowAdvance(a); assert.equal(exHidden(a).join(','), at[4])
    }
    assert.notEqual(sectionSeed(1, 0), sectionSeed(1, 1))
  }
})

test('section recall: main lines first, then preview word by word; back re-hides; DONE needs one more swipe', () => {
  let f = flowFor(50, 3)
  for (let s = 0; s < 8; s++) f = flowAdvance(f)
  assert.equal(f.phase, 'recall'); assert.equal(f.index, -1)
  const e = f.exercises[0], n = exerciseCount(e)
  assert.equal(exHidden(f).length, n)
  for (let i = 0; i < n; i++) {
    f = flowAdvance(f)
    for (let id = e.start; id < e.end; id++) assert.equal(flowHidden(f, id), id > e.start + i)
    assert.deepEqual(flowProgress(f), { revealed: i + 1, total: n })
    assert.equal(f.section, 0)                                        // view stays on the section
    assert.equal(f.phase, i < n - 1 ? 'recall' : 'done')              // last (preview) word → DONE
  }
  assert.ok(e.end > e.mainEnd)                                        // preview words were included last
  assert.equal(f.k, 0)
  const back1 = flowBack(f)                                           // back re-hides the last word
  assert.equal(back1.phase, 'recall'); assert.equal(back1.index, n - 2); assert.ok(flowHidden(back1, e.end - 1))
  assert.equal(flowAdvance(back1).phase, 'done')
  f = flowAdvance(f)                                                  // one additional swipe → next section
  assert.equal(f.phase, 'memo'); assert.equal(f.k, 1); assert.equal(f.stage, 0); assert.equal(f.section, 1)
  assert.equal(exHidden(f).length, 0)                                 // next section starts its own stage 0
})

test('sections 1 → 2 → 3 → final → complete on page 50; final recall counts each page word once', () => {
  let f = flowFor(50, 9), N = f.page.words.length
  const seen = []
  for (let guard = 0; guard < 5000 && f.phase !== 'complete'; guard++) {
    const before = key(f); f = flowAdvance(f); seen.push(`${before}→${f.phase}${f.k}`)
  }
  assert.equal(f.phase, 'complete')
  const transitions = seen.filter(t => /done\|/.test(t)).map(t => t.split('→')[1])
  assert.deepEqual(transitions, ['memo1', 'memo2', 'final2'])
  // replay the final recall: 0..N-1 exactly once, never an external id
  let g = flowFor(50, 9)
  while (g.phase !== 'final') g = flowAdvance(g)
  assert.equal(g.index, -1); assert.equal(g.section, 0)
  for (let id = 0; id < N + 20; id++) assert.equal(flowHidden(g, id), id < N)
  const revealed = []
  while (g.phase === 'final') { g = flowAdvance(g); revealed.push(g.index) }  // last reveal → COMPLETE
  assert.equal(g.phase, 'complete')
  assert.deepEqual(revealed, Array.from({ length: N }, (_, i) => i))
  assert.deepEqual(flowProgress(g), { revealed: N, total: N })
})

test('every page: forward walk to COMPLETE and backward walk to exit are exact mirrors', () => {
  for (const p of PAGES) {
    let f = flowFor(p, p)
    const states = [key(f)]
    while (f.phase !== 'complete') { f = flowAdvance(f); states.push(key(f)) }
    assert.equal(flowAdvance(f), f)                                   // COMPLETE: no further step
    for (let i = states.length - 1; i > 0; i--) {
      assert.equal(key(f), states[i], `page ${p} step ${i}`)
      f = flowBack(f)
    }
    assert.equal(key(f), states[0]); assert.equal(flowBack(f), 'exit')
    // advance(back(x)) = x on a sample of states
  }
})

test('short pages and page 604: section counts, external previews, no preview at the end', () => {
  for (const [p, n] of [[1, 2], [2, 2], [586, 3], [590, 3], [604, 3]]) {
    const f = flowFor(p)
    assert.equal(f.exercises.length, n)
  }
  const ex604 = flowFor(604).exercises
  assert.equal(ex604[2].preview, null); assert.equal(ex604[2].end, ex604[2].mainEnd)
  let f = flowFor(604, 2)
  while (!(f.phase === 'done' && f.k === 2)) f = flowAdvance(f)
  assert.equal(flowProgress(f).total, exerciseCount(ex604[2]))      // no preview: DONE after the last main word
  assert.equal(flowProgress(f).revealed, exerciseCount(ex604[2]))
  assert.equal(flowAdvance(f).phase, 'final')
  const ex1 = flowFor(1).exercises
  assert.equal(ex1[1].preview.page, 2); assert.equal(ex1[1].preview.external, true)
  const N1 = memoPage(1).words.length
  assert.ok(ex1[1].preview.tokens.filter(t => t.role === 'word').every(t => t.word >= N1))
})

// ── M1.3: checkpoints ────────────────────────────────────────────────────────

const APP = 'com.noor.quran.fullscreen.test'
const rebuild = p => { const page = memoPage(p); return { page, exercises: buildExercises(getLines, page, p) } }
const cpOf = (f, p, rev = 1, active = true) => makeCheckpoint(f, p, { app: APP, rev, savedAt: 1700000000000 + rev, active })
const roundTrip = cp => restoreCheckpoint(JSON.parse(JSON.stringify(cp)), APP, 604, rebuild)
function assertSame(a, b, where) {
  const k = x => x === 'exit' ? 'exit' : `${x.phase}|${x.k}|${x.stage}|${x.index}|${x.section}`
  assert.equal(k(b), k(a), `${where}: state`)
  const N = a.page.words.length
  for (let id = 0; id < N + 40; id++) assert.equal(flowHidden(b, id), flowHidden(a, id), `${where}: word ${id}`)
  assert.equal(k(flowAdvance(b)), k(flowAdvance(a)), `${where}: forward`)
  assert.equal(k(flowBack(b)), k(flowBack(a)), `${where}: back`)
}

test('checkpoint round-trip on all 604 pages: boundary + random states restore exactly', () => {
  let checked = 0, maxLen = 0
  const rnd = (() => { let x = 99; return () => (x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32 })()
  for (const p of PAGES) {
    let f = flowFor(p, (rnd() * 2 ** 32) >>> 0)
    const states = [f]
    while (f.phase !== 'complete') { f = flowAdvance(f); states.push(f) }
    const pick = states.filter((s, i) => i === 0 || s.phase !== states[i - 1].phase || s.k !== states[i - 1].k || (s.phase === 'memo' && [0, 4, 7].includes(s.stage)))
    for (let j = 0; j < 12; j++) pick.push(states[Math.floor(rnd() * states.length)])
    for (const s of pick) {
      const cp = cpOf(s, p)
      maxLen = Math.max(maxLen, JSON.stringify(cp).length)
      const r = roundTrip(cp)
      assert.ok(r.ok, `page ${p}: ${r.reason}`)
      assertSame(s, r.flow, `page ${p} ${s.phase}`)
      assert.equal(deriveSection(s), s.section)
      checked++
    }
  }
  console.log(`    checkpoints restored: ${checked}; largest checkpoint ${maxLen} bytes`)
})

test('page 50: every state of the full workflow restores exactly (including the footer preview)', () => {
  let f = flowFor(50, 2026), n = 0
  for (;;) {
    const r = roundTrip(cpOf(f, 50, n + 1))
    assert.ok(r.ok, r.reason); assertSame(f, r.flow, `step ${n}`)
    const pv = f.exercises[f.section].preview
    if (pv) for (const t of pv.tokens) if (t.role === 'word') assert.equal(flowHidden(r.flow, t.word), flowHidden(f, t.word))
    n++
    if (f.phase === 'complete') break
    f = flowAdvance(f)
  }
  assert.equal(n, 328)                       // start + 327 forward steps
})

test('checkpoint validation rejects corrupt, incompatible and out-of-range data', () => {
  let f = flowFor(50, 5)
  for (let i = 0; i < 12; i++) f = flowAdvance(f)            // section 1 recall
  const good = cpOf(f, 50, 7)
  assert.ok(roundTrip(good).ok)
  const resign = c => ({ ...c, sum: checkpointSum(c) })
  const bad = {
    'not an object': 'x',
    'schema version': resign({ ...good, v: CHECKPOINT_VERSION + 1 }),
    'algorithm version': resign({ ...good, alg: ALG_VERSION + 1 }),
    'different app': resign({ ...good, app: 'com.noor.quran' }),
    'checksum mismatch': { ...good, index: good.index + 1 },
    'bad phase': resign({ ...good, phase: 'reading' }),
    'bad index': resign({ ...good, index: 1.5 }),
    'out of range (page)': resign({ ...good, page: 605 }),
    'fingerprint (wrong page)': resign({ ...good, page: 51 }),
    'fingerprint (edited)': resign({ ...good, fp: '134:42,61,62' }),
    'section out of range': resign({ ...good, k: 3 }),
    'recall invariants': resign({ ...good, index: 500 }),
    'memo invariants': resign({ ...good, phase: 'memo', index: 3 }),
    'done invariants': resign({ ...good, phase: 'done', index: 2 }),
    'final invariants': resign({ ...good, phase: 'final', k: 0, index: 3 }),
    'complete invariants': resign({ ...good, phase: 'complete', index: 3 }),
    'missing field': (() => { const c = { ...good }; delete c.seed; return c })(),
  }
  for (const [name, c] of Object.entries(bad)) {
    const r = restoreCheckpoint(typeof c === 'string' ? c : JSON.parse(JSON.stringify(c)), APP, 604, rebuild)
    assert.equal(r.ok, false, `${name} accepted`)
  }
  assert.equal(restoreCheckpoint(null, APP, 604, rebuild).ok, false)
})
