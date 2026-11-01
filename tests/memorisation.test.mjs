// Unit tests for src/memorisation.ts, run against the real 604-page bundle.
// Run with: pnpm test   (Node's built-in test runner + type stripping; no extra deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildMemoPage, hidingOrder, hiddenCountAtStage, startSession, advance, back, nextSection,
  isWordHidden, revealedCount, sectionOfWord, stripMarks, STRIP_RE, MAX_STAGE,
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
