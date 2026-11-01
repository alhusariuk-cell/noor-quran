/**
 * Noor – memorisation (حفظ) and recall (تسميع) logic for one Mushaf page.
 *
 * Pure functions only (no DOM, no SDK), so they can be unit-tested with
 * `node --test`. Rendering and event wiring live in main.ts.
 *
 * The hiding sequence is a port of Hafiz `_preCalculateStages`
 * (lib/providers/lesson_provider.dart):
 *   1. hideable = every word on the page except ayah-number markers, in
 *      reading order (line order, then word order within the line).
 *   2. Shuffle once (Fisher–Yates; here with a seeded PRNG so a session
 *      can be reproduced from its logged seed).
 *   3. First pass: take a word only if neither neighbour in `hideable` has
 *      already been taken (adjacency is page-wide, across line breaks and
 *      across ayah markers).
 *   4. Second pass: append the remaining words in shuffled order.
 *   5. Stage k (1–6) hides the first round(k × N / 7) words of that order;
 *      stage 7 hides all N. Stages are cumulative.
 *
 * Only erasable TypeScript syntax is used (no enums/namespaces) so Node's
 * built-in type stripping can run the tests without extra dependencies.
 */

export const MAX_STAGE = 7
export const LINES_PER_SECTION = 5

/**
 * Same character class as stripWaqfMarkers() in main.ts. Reading Mode strips
 * these before drawing; memorisation must tokenise identically so that word
 * positions match Reading Mode exactly (guarded by a unit test).
 */
export const STRIP_RE = /[۟-۪ۨ-ۭ؀-؅]/g
const AYAH_NUMBER_RE = /^[٠-٩]+$/

export function stripMarks(text: string): string {
  return text.replace(STRIP_RE, '')
}

// ─── Page model ───────────────────────────────────────────────────────────────

export interface SourceLine {
  type: string
  text?: string
  words?: { word: string }[]
}

/** One space-separated piece of a line, exactly as Reading Mode draws it. */
export interface MemoToken {
  text: string
  /** 'ayah' = ayah-number marker (never hidden); 'word' = part of a hideable word */
  role: 'word' | 'ayah'
  /** Index into MemoPage.words for role 'word'; -1 for 'ayah'. */
  word: number
}

export interface MemoLine {
  type: string
  /** Text used for font-size fitting — identical to Reading Mode's string. */
  text: string
  tokens: MemoToken[]
}

export interface MemoPage {
  lines: MemoLine[]
  /** Hideable words in reading order: the line index each one sits on. */
  words: { line: number }[]
  sectionCount: number
}

/** Build the memorisation model for a page from the bundled line data. */
export function buildMemoPage(lines: SourceLine[]): MemoPage {
  const words: { line: number }[] = []
  const out: MemoLine[] = []
  lines.forEach((line, li) => {
    if (line.type !== 'text') {
      out.push({ type: line.type, text: line.text ?? '', tokens: [] })
      return
    }
    const src = line.words ?? []
    // Same expression Reading Mode uses (renderLinesToQuads).
    const text = stripMarks(src.length > 0 ? src.map(w => w.word).join(' ') : (line.text ?? ''))
    const tokens: MemoToken[] = []
    if (src.length === 0) {
      // No word data: show as-is, nothing hideable (does not occur in the bundle).
      for (const t of text.split(' ').filter(Boolean)) tokens.push({ text: t, role: 'ayah', word: -1 })
    } else {
      for (const w of src) {
        const parts = stripMarks(w.word).split(' ').filter(Boolean)
        // Trailing Arabic-Indic digits = the ayah-number marker attached to the
        // ayah's final word in Noor's data (Hafiz keeps it as a separate entry).
        const hasMarker = parts.length > 0 && AYAH_NUMBER_RE.test(parts[parts.length - 1])
        const wordParts = hasMarker ? parts.length - 1 : parts.length
        const idx = wordParts > 0 ? words.length : -1
        if (wordParts > 0) words.push({ line: li })
        parts.forEach((p, pi) => {
          tokens.push(pi < wordParts
            ? { text: p, role: 'word', word: idx }
            : { text: p, role: 'ayah', word: -1 })
        })
      }
    }
    out.push({ type: 'text', text, tokens })
  })
  return { lines: out, words, sectionCount: Math.max(1, Math.ceil(lines.length / LINES_PER_SECTION)) }
}

export function sectionOfLine(line: number): number {
  return Math.floor(line / LINES_PER_SECTION)
}

export function sectionOfWord(page: MemoPage, word: number): number {
  return sectionOfLine(page.words[word].line)
}

// ─── Seeded hiding order (Hafiz two-pass algorithm) ───────────────────────────

/** mulberry32 — small, fast, deterministic PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Hiding order over word indices 0..total-1. Port of Hafiz `_preCalculateStages`
 * (shuffle → non-adjacent first pass → remainder second pass).
 */
export function hidingOrder(total: number, seed: number): number[] {
  const rnd = mulberry32(seed)
  const shuffled = Array.from({ length: total }, (_, i) => i)
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t
  }
  const picked = new Uint8Array(total)
  const order: number[] = []
  for (const w of shuffled) {
    const leftPicked = w > 0 && picked[w - 1] === 1
    const rightPicked = w < total - 1 && picked[w + 1] === 1
    if (!leftPicked && !rightPicked) { picked[w] = 1; order.push(w) }
  }
  for (const w of shuffled) if (picked[w] === 0) order.push(w)
  return order
}

/** Number of hidden words at a stage (Hafiz: round((k) × N / 7), stage 7 = N). */
export function hiddenCountAtStage(stage: number, total: number): number {
  if (stage <= 0) return 0
  if (stage >= MAX_STAGE) return total
  return Math.round(stage * total / MAX_STAGE)
}

/** rank[word] = position of the word in the hiding order. */
export function rankOf(order: number[]): Int32Array {
  const rank = new Int32Array(order.length)
  order.forEach((w, i) => { rank[w] = i })
  return rank
}

// ─── Session state machine ────────────────────────────────────────────────────

/**
 * 'lesson'  (دروس)  — starts at stage 0; seven cumulative hiding stages, then recall.
 * 'tasteer' (تسطير) — starts directly in recall with every eligible word hidden.
 */
export type Activity = 'lesson' | 'tasteer'

export interface MemoSession {
  page: MemoPage
  seed: number
  rank: Int32Array
  activity: Activity
  phase: 'memo' | 'recall'
  stage: number        // 0..7 (memo phase)
  recallIndex: number  // -1..N-1: index of the last revealed word (recall phase)
  section: number      // currently displayed five-line section
}

/** New دروس session at stage 0. */
export function startSession(page: MemoPage, seed: number, section: number): MemoSession {
  return {
    page, seed,
    rank: rankOf(hidingOrder(page.words.length, seed)),
    activity: 'lesson',
    phase: 'memo', stage: 0, recallIndex: -1,
    section: Math.min(Math.max(0, section), page.sectionCount - 1),
  }
}

/** New تسطير session: recall from the start, all eligible words hidden, first section. */
export function startTasteer(page: MemoPage, seed: number): MemoSession {
  return { ...startSession(page, seed, 0), activity: 'tasteer', phase: 'recall', stage: MAX_STAGE }
}

/** Result of a gesture: the new session, or 'exit' to return to Reading Mode. */
export type MemoResult = MemoSession | 'exit'

/** SCROLL_BOTTOM_EVENT: next stage / enter recall / reveal next word. */
export function advance(s: MemoSession): MemoSession {
  if (s.phase === 'memo') {
    if (s.stage < MAX_STAGE) return { ...s, stage: s.stage + 1 }
    return { ...s, phase: 'recall', recallIndex: -1 }
  }
  const next = s.recallIndex + 1
  if (next >= s.page.words.length) return s
  return { ...s, recallIndex: next, section: sectionOfWord(s.page, next) }
}

/**
 * SCROLL_TOP_EVENT: previous stage / re-hide last word / recall start → stage 7.
 * At memorisation stage 0 it returns 'exit' (back to Reading Mode). A تسطير
 * session has no stages, so back before its first word also exits.
 */
export function back(s: MemoSession): MemoResult {
  if (s.phase === 'recall') {
    if (s.recallIndex < 0) return s.activity === 'tasteer' ? 'exit' : { ...s, phase: 'memo', stage: MAX_STAGE }
    return { ...s, recallIndex: s.recallIndex - 1, section: sectionOfWord(s.page, s.recallIndex) }
  }
  if (s.stage > 0) return { ...s, stage: s.stage - 1 }
  return 'exit'
}

/** Single press: next five-line section, wrapping to the first. */
export function nextSection(s: MemoSession): MemoSession {
  return { ...s, section: (s.section + 1) % s.page.sectionCount }
}

export function isWordHidden(s: MemoSession, word: number): boolean {
  if (s.phase === 'recall') return word > s.recallIndex
  return s.rank[word] < hiddenCountAtStage(s.stage, s.page.words.length)
}

export function revealedCount(s: MemoSession): number {
  return s.phase === 'recall' ? s.recallIndex + 1 : 0
}

// ─── Next-line preview (M1.2 experiment A) ───────────────────────────────────

export interface PreviewLine {
  /** Mushaf page and 0-based line index the preview comes from. */
  page: number
  line: number
  /** Exactly the string Reading Mode draws for that line (same stripping, same order). */
  text: string
}

/**
 * The first Quran text line after `section` on `page`: from the next section's
 * first line onwards, continuing onto following pages, skipping surah headings
 * and basmala lines (as Hafiz does for its next-page preview). Returns null
 * when no text line follows (end of page 604). The text is taken verbatim from
 * the Mushaf data — never reconstructed — and is purely informational: it is
 * not part of the session's hideable words.
 */
export function nextPreviewLine(
  getLines: (page: number) => SourceLine[] | undefined,
  page: number,
  section: number,
  lastPage = 604,
): PreviewLine | null {
  let p = page
  let i = (section + 1) * LINES_PER_SECTION
  while (p <= lastPage) {
    const lines = getLines(p) ?? []
    for (; i < lines.length; i++) {
      const l = lines[i]
      if (l.type !== 'text') continue
      const src = l.words ?? []
      const text = stripMarks(src.length > 0 ? src.map(w => w.word).join(' ') : (l.text ?? ''))
      if (text.trim()) return { page: p, line: i, text }
    }
    p++; i = 0
  }
  return null
}

// ─── M1.2 experiment B: section-by-section workflow with interactive preview ──
//
// Word identity: page words keep their page-wide index 0..N-1 (reading order).
// A section's preview is the first Quran text line after it. Within the page,
// that line's words are the next section's own words (same ids), so they are
// never counted twice. When the preview comes from the next page (last
// section), its words get ids N, N+1, … — they take part in that section's
// exercise only, and never in page progress or the final whole-page recall.
//
// Because words are numbered in reading order and headings/basmala carry no
// words, a section's exercise (its main words followed by its preview words)
// is always one contiguous id range [start, end).

export interface PreviewModel extends PreviewLine {
  /** Preview tokens exactly as Reading Mode splits that line; word ids as described above. */
  tokens: MemoToken[]
  /** True when the preview line is on the next page (ids ≥ N). */
  external: boolean
}

export interface SectionExercise {
  section: number
  start: number     // first main word id
  mainEnd: number   // one past the last main word id
  end: number       // one past the last preview word id (= mainEnd when there is no preview)
  preview: PreviewModel | null
}

/** Build the preview model (tokens with word identities) for a section. */
export function buildPreview(
  getLines: (page: number) => SourceLine[] | undefined,
  page: MemoPage, pageNum: number, section: number, lastPage = 604,
): PreviewModel | null {
  const pv = nextPreviewLine(getLines, pageNum, section, lastPage)
  if (!pv) return null
  if (pv.page === pageNum) {
    return { ...pv, tokens: page.lines[pv.line].tokens.map(t => ({ ...t })), external: false }
  }
  // Next page: its first text line; its local word ids start at 0 → map to N + local id
  const next = buildMemoPage(getLines(pv.page) ?? [])
  const firstLocal = next.words.findIndex(w => w.line === pv.line)
  const N = page.words.length
  const tokens = next.lines[pv.line].tokens.map(t =>
    t.role === 'word' ? { ...t, word: N + (t.word - firstLocal) } : { ...t })
  return { ...pv, tokens, external: true }
}

export function buildExercises(
  getLines: (page: number) => SourceLine[] | undefined,
  page: MemoPage, pageNum: number, lastPage = 604,
): SectionExercise[] {
  const out: SectionExercise[] = []
  for (let k = 0; k < page.sectionCount; k++) {
    let start = page.words.findIndex(w => sectionOfLine(w.line) >= k)
    if (start < 0) start = page.words.length
    let mainEnd = page.words.findIndex(w => sectionOfLine(w.line) > k)
    if (mainEnd < 0) mainEnd = page.words.length
    const preview = buildPreview(getLines, page, pageNum, k, lastPage)
    const ids = preview ? preview.tokens.filter(t => t.role === 'word').map(t => t.word) : []
    const end = ids.length ? Math.max(...ids) + 1 : mainEnd
    out.push({ section: k, start, mainEnd, end, preview })
  }
  return out
}

/** Per-section seed derived from the session seed (deterministic). */
export function sectionSeed(seed: number, section: number): number {
  return (Math.imul(seed ^ 0x9E3779B9, 0x85EBCA6B) + Math.imul(section + 1, 0xC2B2AE35)) >>> 0
}

export type FlowPhase = 'memo' | 'recall' | 'done' | 'final' | 'complete'

export interface Flow {
  page: MemoPage
  seed: number
  exercises: SectionExercise[]
  /** ranks[k][i] = position of exercise word (start + i) in section k's hiding order */
  ranks: Int32Array[]
  k: number            // active section (memo / recall / done)
  phase: FlowPhase
  stage: number        // 0..7 in 'memo'
  index: number        // recall: -1..count-1 within the exercise; final: -1..N-1 page-wide
  section: number      // displayed section
}

export function exerciseCount(e: SectionExercise): number {
  return e.end - e.start
}

export function startFlow(page: MemoPage, exercises: SectionExercise[], seed: number, section = 0): Flow {
  const k = Math.min(Math.max(0, section), exercises.length - 1)
  return {
    page, seed, exercises,
    ranks: exercises.map(e => rankOf(hidingOrder(exerciseCount(e), sectionSeed(seed, e.section)))),
    k, phase: 'memo', stage: 0, index: -1, section: k,
  }
}

export type FlowResult = Flow | 'exit'

/** SCROLL_BOTTOM_EVENT: one step forward. Never skips a state. */
export function flowAdvance(f: Flow): Flow {
  const e = f.exercises[f.k], N = f.page.words.length
  switch (f.phase) {
    case 'memo':
      return f.stage < MAX_STAGE ? { ...f, stage: f.stage + 1 } : { ...f, phase: 'recall', index: -1 }
    case 'recall': {
      // Revealing the exercise's last word (normally the last preview word) enters DONE
      const next = f.index + 1
      if (next >= exerciseCount(e) - 1) return { ...f, phase: 'done', index: exerciseCount(e) - 1 }
      return { ...f, index: next }
    }
    case 'done':
      if (f.k < f.exercises.length - 1) return { ...f, k: f.k + 1, phase: 'memo', stage: 0, index: -1, section: f.k + 1 }
      return { ...f, phase: 'final', index: -1, section: 0 }
    case 'final': {
      // Revealing the page's last word enters COMPLETE
      const next = f.index + 1
      if (next >= N - 1) return { ...f, phase: 'complete', index: N - 1, section: sectionOfWord(f.page, N - 1) }
      return { ...f, index: next, section: sectionOfWord(f.page, next) }
    }
    case 'complete':
      return f
  }
}

/** SCROLL_TOP_EVENT: one step back; the exact inverse of flowAdvance. */
export function flowBack(f: Flow): FlowResult {
  const e = f.exercises[f.k], N = f.page.words.length
  switch (f.phase) {
    case 'memo':
      if (f.stage > 0) return { ...f, stage: f.stage - 1 }
      if (f.k > 0) return { ...f, k: f.k - 1, phase: 'done', stage: MAX_STAGE, index: exerciseCount(f.exercises[f.k - 1]) - 1, section: f.k - 1 }
      return 'exit'
    case 'recall':
      if (f.index >= 0) return { ...f, index: f.index - 1 }
      return { ...f, phase: 'memo', stage: MAX_STAGE }
    case 'done':
      // Re-hide the last revealed word
      return { ...f, phase: 'recall', index: exerciseCount(e) - 2 }
    case 'final':
      if (f.index >= 0) {
        const prev = f.index - 1
        return { ...f, index: prev, section: prev >= 0 ? sectionOfWord(f.page, prev) : 0 }
      }
      {
        const last = f.exercises.length - 1
        return { ...f, phase: 'done', k: last, stage: MAX_STAGE, index: exerciseCount(f.exercises[last]) - 1, section: last }
      }
    case 'complete': {
      const prev = N - 2
      return { ...f, phase: 'final', index: prev, section: prev >= 0 ? sectionOfWord(f.page, prev) : 0 }
    }
  }
}

/**
 * Is word `id` (page id, or ≥ N for an external preview word) hidden in the
 * current display? Ids outside the active section's exercise follow page-wide
 * state only during the final recall; otherwise they are shown.
 */
export function flowHidden(f: Flow, id: number): boolean {
  const N = f.page.words.length
  if (f.phase === 'final') return id < N && id > f.index
  if (f.phase === 'complete') return false
  const e = f.exercises[f.k]
  if (id < e.start || id >= e.end) return false
  const pos = id - e.start
  switch (f.phase) {
    case 'memo': return f.ranks[f.k][pos] < hiddenCountAtStage(f.stage, exerciseCount(e))
    case 'recall': return pos > f.index
    default: return false   // done
  }
}

/** Revealed / total for the footer and phone: section exercise or whole page. */
export function flowProgress(f: Flow): { revealed: number; total: number } {
  if (f.phase === 'final') return { revealed: f.index + 1, total: f.page.words.length }
  if (f.phase === 'complete') return { revealed: f.page.words.length, total: f.page.words.length }
  const n = exerciseCount(f.exercises[f.k])
  if (f.phase === 'recall') return { revealed: f.index + 1, total: n }
  if (f.phase === 'done') return { revealed: n, total: n }
  return { revealed: 0, total: n }
}
