/**
 * Noor – Quran Reader for Even Realities G2 Smart Glasses  (v4.6.33)
 *
 * ─── Rendering approach ───────────────────────────────────────────────────────
 * Arabic text is rendered on the phone via HTML5 Canvas + Uthmanic Hafs font
 * and sent as JPEG pixel data.  No fetch() calls — all 604 mushaf pages are
 * bundled inline in mushaf-bundle.ts (~4 MB).
 *
 * ─── G2 display layout ────────────────────────────────────────────────────────
 *   Physical display: 576 × 288 px
 *   Canvas: 576 × 288 px (EXPERIMENTAL full-screen), offset (0, 0)
 *   4 image containers in a 2×2 grid, each 288 × 144 px (SDK max size):
 *     TL (0, 0)     TR (288, 0)
 *     BL (0, 144)   BR (288, 144)
 *
 * ─── Modes ────────────────────────────────────────────────────────────────────
 *   READING  – 5 lines of Quranic text per screen, 3 screens per page
 *   SELECTOR – surah picker, 7 rows visible, one highlighted
 *   MEMO     – دروس (seven-stage progressive hiding) and تسطير (word-by-word
 *              recall) for the current page (test builds; logic in
 *              memorisation.ts). Started from the phone panels via
 *              window.noor.startLesson() / startTasteer(), or from the
 *              glasses selector row. Glasses footer shows دروس / تسطير.
 *
 * ─── Navigation ───────────────────────────────────────────────────────────────
 *   READING mode:
 *     Swipe forward  → next screen / next page
 *     Swipe back     → previous screen / previous page
 *     Single tap     → enter SELECTOR mode
 *     Double tap     → exit plugin
 *
 *   SELECTOR mode:
 *     Swipe forward  → highlight next surah
 *     Swipe back     → highlight previous surah
 *     Single tap     → confirm → jump to highlighted surah → READING
 *     Double tap     → cancel → return to READING
 *     A "حفظ هذه الصفحة" row sits directly above the current surah;
 *     confirming it starts MEMO on the current page and screen.
 *
 *   MEMO mode (mapped by SDK event id, not by physical swipe direction):
 *   Structured دروس flow (M1.2-B), per section incl. its footer preview line:
 *     SCROLL_BOTTOM_EVENT → one step forward: stage 0→7, section recall word by
 *                           word (main lines, then preview), DONE, next section
 *                           (one extra swipe), … final whole-page recall, COMPLETE
 *     SCROLL_TOP_EVENT    → exactly one step back; section 1 stage 0 → READING
 *     Single tap          → no action (never skips a section)
 *     Crossing a phase/section boundary holds same-direction swipes for 800 ms.
 *   Standalone تسطير (phone): page-wide recall as in M1.1; tap → next section.
 *     Double tap          → unchanged: exit popup, as in READING
 */
import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { MUSHAF_DATA } from './mushaf-bundle'
import {
  buildMemoPage, startTasteer, advance as memoAdvanceState, back as memoBackState,
  nextSection as memoNextSectionState, isWordHidden, revealedCount, MAX_STAGE,
  buildExercises, startFlow, flowAdvance, flowBack, flowHidden, flowProgress,
  type MemoSession, type MemoPage, type Activity, type Flow, type SectionExercise, type PreviewModel,
} from './memorisation'

// ─── G2 display constants ─────────────────────────────────────────────────────
const DISPLAY_W    = 576
const DISPLAY_H    = 288
const IMG_W        = 576          // experimental full-width canvas
const IMG_H        = 288          // experimental full-height canvas
const QUAD_W       = 288
const QUAD_H       = 144
const IMG_OFFSET_X = (DISPLAY_W - IMG_W) / 2   // 0
const IMG_OFFSET_Y = (DISPLAY_H - IMG_H) / 2   // 0

// ─── Layout zones within the 576×288 canvas ──────────────────────────────────
//
//   Text area:  y 0  – 257  (258 px for 5 lines)
//   Separator:  y 258
//   Footer:     y 258 – 287 (30 px)
//
const TEXT_AREA_H      = 258
const FOOTER_H         = IMG_H - TEXT_AREA_H   // 30 px
const LINES_PER_SCREEN = 5

// ─── Typography ───────────────────────────────────────────────────────────────
const ARABIC_FONT_URL    = '/fonts/UthmanicHafs.woff2'
const ARABIC_FONT_FAMILY = 'UthmanicHafs'
const TEXT_FONT_SIZE     = 27    // px
const HEADER_FONT_SIZE   = 22    // surah-header / basmala

// Reading footer (page number · screen counter · surah name)
const FOOTER_FONT_SIZE     = 16      // px (was 11)
const FOOTER_MIN_FONT_SIZE = 11      // smallest size a long surah name may shrink to
const FOOTER_COLOR         = '#aaa'  // slightly brighter than the previous #888
const FOOTER_GAP           = 12      // min px between centre counter and surah name

// Text column — slightly narrower than full canvas to leave breathing room
const TEXT_COL_W  = 548
const COL_LEFT    = (IMG_W - TEXT_COL_W) / 2   // 14
const COL_RIGHT   = COL_LEFT + TEXT_COL_W       // 562

// ─── Surah index ──────────────────────────────────────────────────────────────
// [surahNumber, arabicName, firstMushafPage, firstTileIndex (1-based)]
const SURAHS: [number, string, number, number][] = [
  [1,'الفاتحة',1,1],[2,'البقرة',2,1],[3,'آل عمران',50,1],[4,'النساء',77,1],
  [5,'المائدة',106,1],[6,'الأنعام',128,1],[7,'الأعراف',151,1],[8,'الأنفال',177,1],
  [9,'التوبة',187,1],[10,'يونس',208,1],[11,'هود',221,1],[12,'يوسف',235,1],
  [13,'الرعد',249,1],[14,'إبراهيم',255,1],[15,'الحجر',262,1],[16,'النحل',267,1],
  [17,'الإسراء',282,1],[18,'الكهف',293,1],[19,'مريم',305,1],[20,'طه',312,1],
  [21,'الأنبياء',322,1],[22,'الحج',332,1],[23,'المؤمنون',342,1],[24,'النور',350,1],
  [25,'الفرقان',359,1],[26,'الشعراء',367,1],[27,'النمل',377,1],[28,'القصص',385,1],
  [29,'العنكبوت',396,1],[30,'الروم',404,1],[31,'لقمان',411,1],[32,'السجدة',415,1],
  [33,'الأحزاب',418,1],[34,'سبأ',428,1],[35,'فاطر',434,1],[36,'يس',440,1],
  [37,'الصافات',446,1],[38,'ص',453,1],[39,'الزمر',458,1],[40,'غافر',467,1],
  [41,'فصلت',477,1],[42,'الشورى',483,1],[43,'الزخرف',489,1],[44,'الدخان',496,1],
  [45,'الجاثية',499,1],[46,'الأحقاف',502,1],[47,'محمد',507,1],[48,'الفتح',511,1],
  [49,'الحجرات',515,1],[50,'ق',518,1],[51,'الذاريات',520,1],[52,'الطور',523,1],
  [53,'النجم',526,1],[54,'القمر',528,1],[55,'الرحمن',531,1],[56,'الواقعة',534,1],
  [57,'الحديد',537,1],[58,'المجادلة',542,1],[59,'الحشر',545,1],[60,'الممتحنة',549,1],
  [61,'الصف',551,1],[62,'الجمعة',553,1],[63,'المنافقون',554,1],[64,'التغابن',556,1],
  [65,'الطلاق',558,1],[66,'التحريم',560,1],[67,'الملك',562,1],[68,'القلم',564,1],
  [69,'الحاقة',566,1],[70,'المعارج',568,1],[71,'نوح',570,1],[72,'الجن',572,1],
  [73,'المزمل',574,1],[74,'المدثر',575,1],[75,'القيامة',577,1],[76,'الإنسان',578,1],
  [77,'المرسلات',580,1],[78,'النبأ',582,1],[79,'النازعات',583,1],[80,'عبس',585,1],
  [81,'التكوير',586,1],[82,'الانفطار',587,1],[83,'المطففين',587,1],[84,'الانشقاق',589,1],
  [85,'البروج',590,1],[86,'الطارق',591,1],[87,'الأعلى',591,1],[88,'الغاشية',592,1],
  [89,'الفجر',593,1],[90,'البلد',594,1],[91,'الشمس',595,1],[92,'الليل',595,1],
  [93,'الضحى',596,1],[94,'الشرح',596,1],[95,'التين',597,1],[96,'العلق',597,1],
  [97,'القدر',598,1],[98,'البينة',598,1],[99,'الزلزلة',599,1],[100,'العاديات',599,1],
  [101,'القارعة',600,1],[102,'التكاثر',600,1],[103,'العصر',601,1],[104,'الهمزة',601,1],
  [105,'الفيل',601,1],[106,'قريش',602,1],[107,'الماعون',602,1],[108,'الكوثر',602,1],
  [109,'الكافرون',603,1],[110,'النصر',603,1],[111,'المسد',603,1],[112,'الإخلاص',604,1],
  [113,'الفلق',604,1],[114,'الناس',604,1],
]

const TOTAL_PAGES      = 604
const SELECTOR_VISIBLE = 7

// ─── Types ────────────────────────────────────────────────────────────────────
interface MushafWord { location: string; word: string }
interface MushafLine {
  line: number
  type: 'text' | 'surah-header' | 'basmala'
  text?: string
  surah?: string   // present on surah-header lines, e.g. "082"
  words?: MushafWord[]
}
interface MushafPage { page: number; lines: MushafLine[] }
type AppMode = 'reading' | 'selector' | 'memo'

// ─── Bookmark ─────────────────────────────────────────────────────────────────
const BOOKMARK_KEY = 'noor_bookmark'
function saveBookmark(): void {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify({ page: currentPage, screen: currentScreen }))
  } catch (_) {}
  // Also try bridge storage as backup
  getBridge().then(b => {
    if (b.setLocalStorage) {
      b.setLocalStorage(BOOKMARK_KEY, JSON.stringify({ page: currentPage, screen: currentScreen }))
    }
  }).catch(() => {})
}
async function loadBookmark(): Promise<void> {
  // Try bridge storage first
  try {
    const bridge = await getBridge()
    if (bridge.getLocalStorage) {
      const raw = await bridge.getLocalStorage(BOOKMARK_KEY)
      if (raw) {
        const { page, screen } = JSON.parse(raw)
        if (typeof page === 'number' && page >= 1 && page <= TOTAL_PAGES) {
          currentPage   = page
          currentScreen = typeof screen === 'number' ? screen : 0
          return
        }
      }
    }
  } catch (_) {}
  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY)
    if (raw) {
      const { page, screen } = JSON.parse(raw)
      if (typeof page === 'number' && page >= 1 && page <= TOTAL_PAGES) {
        currentPage   = page
        currentScreen = typeof screen === 'number' ? screen : 0
      }
    }
  } catch (_) {}
}

// ─── Render queue ─────────────────────────────────────────────────────────────
let renderQueue: (() => Promise<void>)[] = []
let renderRunning = false
let renderGeneration = 0
let _displayDirty = true   // true = display needs a heartbeat re-render

function enqueueRender(fn: () => Promise<void>): void {
  renderGeneration++
  _displayDirty = true
  renderQueue = [fn]
  if (!renderRunning) drainQueue()
  // Every state change re-renders through here; tell the phone UI (same WebView) to refresh.
  try { window.dispatchEvent(new CustomEvent('noor:state')) } catch (_) {}
}
async function drainQueue(gen: number = renderGeneration): Promise<void> {
  renderRunning = true
  while (renderQueue.length > 0) {
    if (gen !== renderGeneration) { renderRunning = false; return }  // cancelled
    const next = renderQueue.shift()!
    try { await next() } catch (e) { console.error('[Noor] Queue error:', e) }
  }
  renderRunning = false
}

// ─── State ────────────────────────────────────────────────────────────────────
let _bridge: any       = null
let mode: AppMode      = 'reading'
let currentPage        = 1
let currentScreen      = 0
let currentSurahNum    = 0   // surah number last confirmed; 0 = not set
let selectorIndex      = 0
let selectorMemoRow    = -1  // index of the "حفظ هذه الصفحة" row in the selector list
let memo: ActiveSession | null = null
let fontLoaded         = false
let lastEventTime      = 0
let lastNavTime: Record<number, number> = {}
let selectorConfirmedAt = 0
let _pendingResume      = false  // true after shutDownPageContainer — reset debounce on next event
let _unsubNav: (() => void) | null = null  // unsubscribe handle for onEvenHubEvent
// Debug counters — shown in footer on glasses
let _dbgEventCount = 0
let _dbgLastEvent  = -1
let _dbgRenderCount = 0
let _dbgResetCount = 0

const EVENT_DEBOUNCE_MS   = 350
const NAV_DEBOUNCE_MS     = 400
const CONFIRM_COOLDOWN_MS = 600

// ─── Bridge ───────────────────────────────────────────────────────────────────
async function getBridge(): Promise<any> {
  if (!_bridge) _bridge = await waitForEvenAppBridge()
  return _bridge
}

// ─── Font ─────────────────────────────────────────────────────────────────────
async function ensureFontLoaded(): Promise<void> {
  if (fontLoaded) return
  try {
    const font = new FontFace(ARABIC_FONT_FAMILY, `url(${ARABIC_FONT_URL})`)
    document.fonts.add(await font.load())
  } catch (e) {
    console.warn('[Noor] Font load failed:', e)
  }
  fontLoaded = true
}

// ─── Data (synchronous — no fetch()) ─────────────────────────────────────────
function getPage(n: number): MushafPage {
  const data = (MUSHAF_DATA as Record<number, MushafPage>)[n]
  if (data) return data
  return { page: n, lines: [] }
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  return [c, ctx]
}


/**
 * Convert a canvas to a JPEG number[] for ImageRawDataUpdate.
 * Uses fetch(dataURL) to get raw bytes without a per-byte atob() loop.
 * Returns number[] (not Uint8Array) so the host Dart/Flutter bridge
 * receives a properly-aligned List<int> — avoids LVGL software fallback.
 * Quality 0.75: ~25% smaller payload vs 0.88 — reduces D-Cache pressure on G2.
 */
/**
 * Encode canvas to PNG (lossless) → number[].
 * PNG eliminates JPEG compression artefacts (mosquito noise) around Arabic text.
 * Returns number[] so the host Dart/Flutter bridge receives a properly-aligned
 * List<int> — avoids LVGL software fallback (EvenHub store requirement).
 * Arabic text on white background compresses very efficiently with PNG DEFLATE.
 */
function canvasToPngNumberArray(canvas: HTMLCanvasElement): number[] {
  const b64 = canvas.toDataURL('image/png').split(',')[1]
  const bin = atob(b64)
  const bytes = new Array<number>(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Slice the 576×288 canvas into 4 quadrant JPEG number[] arrays (TL, TR, BL, BR).
 * Sequential (not parallel) to avoid race conditions between async fetch() calls
 * sharing the same canvas context. Canvas width is reassigned to fully reset
 * all context state between uses (clearRect alone does not reset transforms etc). */
/** Slice the 576×288 canvas into 4 quadrant PNG number[] arrays (TL, TR, BL, BR) */
function sliceQuadrants(canvas: HTMLCanvasElement): [number[], number[], number[], number[]] {
  const quad = (sx: number, sy: number): number[] => {
    const [t, tc] = makeCanvas(QUAD_W, QUAD_H)
    tc.drawImage(canvas, sx, sy, QUAD_W, QUAD_H, 0, 0, QUAD_W, QUAD_H)
    return canvasToPngNumberArray(t)
  }
  return [
    quad(0,      0),
    quad(QUAD_W, 0),
    quad(0,      QUAD_H),
    quad(QUAD_W, QUAD_H),
  ]
}

// ─── Arabic text helpers ──────────────────────────────────────────────────────
/**
 * Strip Uthmanic orthographic marks that render as distracting filled circles
 * on the glasses display.
 */
function stripWaqfMarkers(text: string): string {
  return text.replace(/[\u06DF-\u06E8\u06EA-\u06ED\u0600-\u0605]/g, '')
}

function toArabicNumerals(n: number): string {
  return String(n).replace(/\d/g, d => String.fromCharCode(0x0660 + parseInt(d)))
}

function surahNameForPage(page: number): string {
  let best = SURAHS[0]
  for (const s of SURAHS) {
    if (s[2] <= page) best = s
    else break
  }
  return best[1]
}

// ─── Reading mode rendering ───────────────────────────────────────────────────
/**
 * Render 5 lines of Quranic text onto a 576×288 canvas with a footer bar,
 * then slice into 4 quadrant tiles.
 */
function renderLinesToQuads(
  lines: MushafLine[],
  screenIdx: number,
  totalScreens: number,
  pageNum: number,
  surahName: string
): [number[], number[], number[], number[]] {
  const lineH = Math.floor(TEXT_AREA_H / Math.max(lines.length, 1))
  const [canvas, ctx] = makeCanvas(IMG_W, IMG_H)
  ctx.fillStyle = '#fff'
  ctx.direction = 'rtl'
  ctx.textBaseline = 'middle'

  lines.forEach((line, i) => {
    const y = i * lineH + lineH / 2
    if (line.type === 'surah-header') {
      // Decorative border lines
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(COL_LEFT, i * lineH + 3); ctx.lineTo(COL_RIGHT, i * lineH + 3); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(COL_LEFT, (i + 1) * lineH - 3); ctx.lineTo(COL_RIGHT, (i + 1) * lineH - 3); ctx.stroke()
      ctx.font = `${HEADER_FONT_SIZE}px '${ARABIC_FONT_FAMILY}', serif`
      ctx.textAlign = 'center'
      const rawText = (line.text ?? '').trim()
      const headerName = rawText.startsWith('سورة ') ? rawText : `سورة ${rawText}`
      ctx.fillText(headerName, IMG_W / 2, y)
    } else if (line.type === 'basmala') {
      ctx.font = `${HEADER_FONT_SIZE}px '${ARABIC_FONT_FAMILY}', serif`
      ctx.textAlign = 'center'
      ctx.fillText('بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ', IMG_W / 2, y)
    } else {
      const text = stripWaqfMarkers(
        line.words && line.words.length > 0
          ? line.words.map(w => w.word).join(' ')
          : (line.text ?? '')
      )
      // Shrink font if the line is too wide for the column
      let fs = TEXT_FONT_SIZE
      ctx.font = `${fs}px '${ARABIC_FONT_FAMILY}', serif`
      while (ctx.measureText(text).width > TEXT_COL_W && fs > 12) {
        fs--
        ctx.font = `${fs}px '${ARABIC_FONT_FAMILY}', serif`
      }
      // RTL word-gap justification
      const words = text.split(' ').filter(Boolean)
      if (words.length <= 1) {
        ctx.textAlign = 'center'
        ctx.fillText(text, IMG_W / 2, y)
      } else {
        const wordWidths = words.map(w => ctx.measureText(w).width)
        const totalWordW = wordWidths.reduce((a, b) => a + b, 0)
        const gap = Math.max(0, (TEXT_COL_W - totalWordW) / (words.length - 1))
        ctx.textAlign = 'left'
        let x = COL_RIGHT
        for (let wi = 0; wi < words.length; wi++) {
          x -= wordWidths[wi]
          ctx.fillText(words[wi], x, y)
          if (wi < words.length - 1) x -= gap
        }
      }
    }
  })

  // ── Footer bar ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(COL_LEFT, TEXT_AREA_H); ctx.lineTo(COL_RIGHT, TEXT_AREA_H); ctx.stroke()
  const footerY = TEXT_AREA_H + FOOTER_H / 2
  ctx.textBaseline = 'middle'
  // Left: page number
  ctx.fillStyle = FOOTER_COLOR; ctx.font = `${FOOTER_FONT_SIZE}px monospace`
  ctx.textAlign = 'left'; ctx.direction = 'ltr'
  ctx.fillText(`ص${toArabicNumerals(pageNum)}`, COL_LEFT, footerY)
  // Centre: screen counter
  const counter = `${toArabicNumerals(screenIdx + 1)}/${toArabicNumerals(totalScreens)}`
  const counterHalfW = ctx.measureText(counter).width / 2
  ctx.textAlign = 'center'
  ctx.fillText(counter, IMG_W / 2, footerY)
  // Right: surah name — shrink locally if it would reach the centre counter
  if (surahName) {
    const maxNameW = COL_RIGHT - (IMG_W / 2 + counterHalfW + FOOTER_GAP)
    let fs = FOOTER_FONT_SIZE
    ctx.font = `${fs}px '${ARABIC_FONT_FAMILY}', serif`
    while (ctx.measureText(surahName).width > maxNameW && fs > FOOTER_MIN_FONT_SIZE) {
      fs--
      ctx.font = `${fs}px '${ARABIC_FONT_FAMILY}', serif`
    }
    ctx.textAlign = 'right'; ctx.direction = 'rtl'
    ctx.fillText(surahName, COL_RIGHT, footerY, maxNameW)
  }
  return sliceQuadrants(canvas)
}

// ─── Selector mode rendering ──────────────────────────────────────────────────
const MEMO_ROW_LABEL = 'حفظ هذه الصفحة'

/** Selector rows: the surahs, with the memorisation row inserted at selectorMemoRow. */
function selectorItemCount(): number {
  return SURAHS.length + (selectorMemoRow >= 0 ? 1 : 0)
}
/** Surah at a selector row, or null for the memorisation row. */
function selectorItem(i: number): [number, string, number, number] | null {
  if (selectorMemoRow < 0 || i < selectorMemoRow) return SURAHS[i]
  if (i === selectorMemoRow) return null
  return SURAHS[i - 1]
}

function renderSelectorQuads(): [number[], number[], number[], number[]] {
  const [canvas, ctx] = makeCanvas(IMG_W, IMG_H)
  const rowH = Math.floor(TEXT_AREA_H / SELECTOR_VISIBLE)
  const half  = Math.floor(SELECTOR_VISIBLE / 2)
  const start = Math.max(0, Math.min(selectorIndex - half, selectorItemCount() - SELECTOR_VISIBLE))
  const visible: ([number, string, number, number] | null)[] = []
  for (let r = start; r < Math.min(start + SELECTOR_VISIBLE, selectorItemCount()); r++) visible.push(selectorItem(r))

  visible.forEach((item, i) => {
    const [num, name] = item ?? [0, MEMO_ROW_LABEL]
    const isSelected = (start + i) === selectorIndex
    const y = i * rowH
    if (isSelected) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(COL_LEFT, y, TEXT_COL_W, rowH)
    }
    ctx.fillStyle = isSelected ? '#000' : '#fff'
    ctx.font = `14px '${ARABIC_FONT_FAMILY}', serif`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.direction = 'rtl'
    ctx.fillText(name, COL_RIGHT, y + rowH / 2)
    if (!item) return   // memorisation row: no surah number
    // Surah number on the left
    ctx.fillStyle = isSelected ? '#000' : '#888'
    ctx.font = '11px monospace'
    ctx.textAlign = 'left'
    ctx.direction = 'ltr'
    ctx.fillText(String(num), COL_LEFT, y + rowH / 2)
  })

  // Footer
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(COL_LEFT, TEXT_AREA_H); ctx.lineTo(COL_RIGHT, TEXT_AREA_H); ctx.stroke()
  const footerY = TEXT_AREA_H + FOOTER_H / 2
  ctx.fillStyle = '#888'; ctx.font = '11px monospace'
  ctx.textAlign = 'center'; ctx.direction = 'ltr'
  ctx.textBaseline = 'middle'
  ctx.fillText('tap to select', IMG_W / 2, footerY)

  return sliceQuadrants(canvas)
}

// ─── SDK helpers ──────────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function sendImage(id: number, name: string, data: number[]): Promise<void> {
  const bridge = await getBridge()
  // Timeout guard: bridge.updateImageRawData can hang indefinitely when
  // the G2 is showing a popup overlay. If it doesn't resolve in 2s,
  // treat it as a no-op so drainQueue() can continue and renderRunning
  // is eventually reset to false.
  await Promise.race([
    bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: id, containerName: name, imageData: data })),
    new Promise<void>(resolve => setTimeout(resolve, 400))
  ])
}

async function sendQuads(tiles: [number[], number[], number[], number[]]): Promise<void> {
  const [tl, tr, bl, br] = tiles
  // Sequential sends — avoid concurrent sends per SDK guidance
  await sendImage(1, 'quad_tl', tl)
  await sendImage(2, 'quad_tr', tr)
  await sendImage(3, 'quad_bl', bl)
  await sendImage(4, 'quad_br', br)
  _displayDirty = false   // display is now up to date
}

// ─── Container setup ──────────────────────────────────────────────────────────
async function setupContainers(): Promise<void> {
  const bridge = await getBridge()
  await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
    containerTotalNum: 5,
    textObject: [
      new TextContainerProperty({
        xPosition: 0, yPosition: 0, width: DISPLAY_W, height: DISPLAY_H,
        borderWidth: 0, borderColor: 0, paddingLength: 0,
        containerID: 5, containerName: 'evt', content: '', isEventCapture: 1,
      }),
    ],
    imageObject: [
      new ImageContainerProperty({ xPosition: IMG_OFFSET_X,           yPosition: IMG_OFFSET_Y,           width: QUAD_W, height: QUAD_H, containerID: 1, containerName: 'quad_tl' }),
      new ImageContainerProperty({ xPosition: IMG_OFFSET_X + QUAD_W,  yPosition: IMG_OFFSET_Y,           width: QUAD_W, height: QUAD_H, containerID: 2, containerName: 'quad_tr' }),
      new ImageContainerProperty({ xPosition: IMG_OFFSET_X,           yPosition: IMG_OFFSET_Y + QUAD_H,  width: QUAD_W, height: QUAD_H, containerID: 3, containerName: 'quad_bl' }),
      new ImageContainerProperty({ xPosition: IMG_OFFSET_X + QUAD_W,  yPosition: IMG_OFFSET_Y + QUAD_H,  width: QUAD_W, height: QUAD_H, containerID: 4, containerName: 'quad_br' }),
    ],
  }))
  await delay(500)
}

function resumeRender(): void {
  if (mode === 'reading') renderReadingView()
  else if (mode === 'memo') renderMemoView()
  else renderSelectorView()
}

// ─── Reading mode ─────────────────────────────────────────────────────────────
function screensForPage(lines: MushafLine[]): number {
  return Math.ceil(lines.length / LINES_PER_SCREEN)
}

/**
 * Find which screen (0-based) on a page contains the surah-header for the
 * given surah number.
 */
function screenForSurahHeader(lines: MushafLine[], surahNum: number): number {
  const paddedNum = String(surahNum).padStart(3, '0')
  // First try: find a header whose `surah` field matches exactly
  let idx = lines.findIndex(l => l.type === 'surah-header' && l.surah === paddedNum)
  if (idx >= 0) return Math.floor(idx / LINES_PER_SCREEN)
  // Second try: find a header whose text contains the surah name from SURAHS array
  const entry = SURAHS.find(([n]) => n === surahNum)
  if (entry) {
    const name = entry[1]
    idx = lines.findIndex(l =>
      l.type === 'surah-header' &&
      (l.text ?? '').replace('سورة ', '').trim() === name
    )
    if (idx >= 0) return Math.floor(idx / LINES_PER_SCREEN)
  }
  return 0
}

async function _doRenderReadingView(): Promise<void> {
  _dbgRenderCount++
  const gen = renderGeneration
  await ensureFontLoaded()
  if (gen !== renderGeneration) return
  const pageData = getPage(currentPage)
  const lines    = pageData.lines
  const start    = currentScreen * LINES_PER_SCREEN
  const slice    = [...lines.slice(start, start + LINES_PER_SCREEN)]
  while (slice.length < LINES_PER_SCREEN) slice.push({ line: -1, type: 'text', text: '' })
  const surahName = surahNameForPage(currentPage)
  const quads = renderLinesToQuads(slice, currentScreen, screensForPage(lines), currentPage, surahName)
  if (gen !== renderGeneration) return
  await sendQuads(quads)
}

function renderReadingView(): void {
  enqueueRender(async () => {
    try { await _doRenderReadingView() }
    catch (e: any) { console.error('[Noor] Render error:', e) }
  })
}

// ─── Selector mode ────────────────────────────────────────────────────────────
async function _doRenderSelectorView(): Promise<void> {
  const gen = renderGeneration
  await ensureFontLoaded()
  if (gen !== renderGeneration) return
  const quads = renderSelectorQuads()
  if (gen !== renderGeneration) return
  await sendQuads(quads)
}

function renderSelectorView(): void {
  enqueueRender(async () => {
    try { await _doRenderSelectorView() }
    catch (e: any) { console.error('[Noor] Selector error:', e) }
  })
}

function enterSelector(): void {
  const closest = SURAHS.reduce((best, s, i) =>
    Math.abs(s[2] - currentPage) < Math.abs(SURAHS[best][2] - currentPage) ? i : best
  , 0)
  // The memorisation row sits directly above the current surah, which stays
  // highlighted on opening exactly as before (one swipe back reaches the row).
  selectorMemoRow = closest
  selectorIndex = closest + 1
  mode = 'selector'
  renderSelectorView()
}

function confirmSelector(): void {
  const item = selectorItem(selectorIndex)
  if (!item) {
    selectorConfirmedAt = Date.now()
    startMemo()
    return
  }
  const [surahNum, , page] = item
  console.log(`[Noor] confirmSelector: surah ${surahNum}, page ${page}`)
  mode            = 'reading'
  currentPage     = page
  currentSurahNum = surahNum
  selectorConfirmedAt = Date.now()
  // Synchronous lookup — no fetch needed
  const pageData = getPage(page)
  currentScreen = screenForSurahHeader(pageData.lines, surahNum)
  saveBookmark()
  renderReadingView()
}

// ─── Memorisation mode (دروس / تسطير) ─────────────────────────────────────────
//
// Two kinds of session:
//   'lesson'  (دروس)  — M1.2-B structured flow, section by section:
//                       MEMO 0–7 → section RECALL → DONE → next section …
//                       → FINAL whole-page recall → COMPLETE. The footer
//                       preview line takes part in each section's exercise.
//   'tasteer' (تسطير) — standalone page-wide recall from the phone (M1.1);
//                       preview words follow the page recall state.
const MEMO_PLACEHOLDER_COLOR = '#888'
const MEMO_PLACEHOLDER_H     = 2      // px
const MEMO_PLACEHOLDER_FILL  = 0.85   // fraction of the word's width (as in Hafiz)
const BOUNDARY_COOLDOWN_MS   = 800    // after crossing a state boundary, ignore same-direction swipes

type ActiveSession =
  | { kind: 'lesson'; flow: Flow }
  | { kind: 'tasteer'; s: MemoSession; exercises: SectionExercise[] }

function sessionPage(a: ActiveSession): MemoPage { return a.kind === 'lesson' ? a.flow.page : a.s.page }
function sessionSection(a: ActiveSession): number { return a.kind === 'lesson' ? a.flow.section : a.s.section }
function sessionPreview(a: ActiveSession): PreviewModel | null {
  const ex = a.kind === 'lesson' ? a.flow.exercises : a.exercises
  return ex[sessionSection(a)]?.preview ?? null
}
/** Is word id (page id, or ≥ N for a next-page preview word) hidden right now? */
function sessionHidden(a: ActiveSession, id: number): boolean {
  if (a.kind === 'lesson') return flowHidden(a.flow, id)
  return id < a.s.page.words.length && isWordHidden(a.s, id)
}

interface PlacedToken { text: string; role: 'word' | 'ayah'; word: number; x: number; w: number }
interface PlacedLine { type: string; text: string; y: number; fs: number; tokens: PlacedToken[] }

/**
 * Lay out one five-line section exactly as renderLinesToQuads does (font
 * fitting and RTL word-gap justification), with every word present.
 */
function layoutMemoSection(ctx: CanvasRenderingContext2D, page: MemoPage, section: number): PlacedLine[] {
  const start = section * LINES_PER_SCREEN
  const lines = page.lines.slice(start, start + LINES_PER_SCREEN)
  const lineH = Math.floor(TEXT_AREA_H / LINES_PER_SCREEN)   // Reading pads to 5 lines too
  return lines.map((line, i) => {
    const y = i * lineH + lineH / 2
    const placed: PlacedLine = { type: line.type, text: line.text, y, fs: TEXT_FONT_SIZE, tokens: [] }
    if (line.type !== 'text' || line.tokens.length === 0) return placed
    const tokens = line.tokens
    let fs = TEXT_FONT_SIZE
    ctx.font = `${fs}px '${ARABIC_FONT_FAMILY}', serif`
    while (ctx.measureText(line.text).width > TEXT_COL_W && fs > 12) {
      fs--
      ctx.font = `${fs}px '${ARABIC_FONT_FAMILY}', serif`
    }
    placed.fs = fs
    const widths = tokens.map(t => ctx.measureText(t.text).width)
    if (tokens.length === 1) {
      placed.tokens.push({ ...tokens[0], x: IMG_W / 2 - widths[0] / 2, w: widths[0] })
      return placed
    }
    const totalW = widths.reduce((a, b) => a + b, 0)
    const gap = Math.max(0, (TEXT_COL_W - totalW) / (tokens.length - 1))
    let x = COL_RIGHT
    for (let ti = 0; ti < tokens.length; ti++) {
      x -= widths[ti]
      placed.tokens.push({ ...tokens[ti], x, w: widths[ti] })
      if (ti < tokens.length - 1) x -= gap
    }
    return placed
  })
}

/** Draw visible tokens; replace hidden words by a thin placeholder over their span. */
function drawTokens(ctx: CanvasRenderingContext2D, tokens: PlacedToken[], y: number, hidden: (id: number) => boolean,
  placeholderColor: string, placeholderY: number): void {
  const spans = new Map<number, [number, number]>()
  ctx.textAlign = 'left'
  for (const t of tokens) {
    if (t.role === 'word' && hidden(t.word)) {
      const sp = spans.get(t.word)
      const l = t.x, r = t.x + t.w
      spans.set(t.word, sp ? [Math.min(sp[0], l), Math.max(sp[1], r)] : [l, r])
    } else {
      ctx.fillText(t.text, t.x, y)
    }
  }
  ctx.fillStyle = placeholderColor
  for (const [l, r] of spans.values()) {
    const w = (r - l) * MEMO_PLACEHOLDER_FILL
    ctx.fillRect(Math.round(l + (r - l - w) / 2), Math.round(placeholderY), Math.max(1, Math.round(w)), MEMO_PLACEHOLDER_H)
  }
}

/**
 * Render one five-line section of the memorisation page. Visible tokens are
 * drawn at their Reading Mode positions; hidden words become thin placeholders
 * at those same positions, so nothing reflows between stages.
 */
function renderMemoQuads(a: ActiveSession, pageNum: number): [number[], number[], number[], number[]] {
  const lineH = Math.floor(TEXT_AREA_H / LINES_PER_SCREEN)
  const [canvas, ctx] = makeCanvas(IMG_W, IMG_H)
  ctx.fillStyle = '#fff'
  ctx.direction = 'rtl'
  ctx.textBaseline = 'middle'
  const hidden = (id: number) => sessionHidden(a, id)

  layoutMemoSection(ctx, sessionPage(a), sessionSection(a)).forEach((line, i) => {
    const y = line.y
    ctx.fillStyle = '#fff'
    if (line.type === 'surah-header') {
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(COL_LEFT, i * lineH + 3); ctx.lineTo(COL_RIGHT, i * lineH + 3); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(COL_LEFT, (i + 1) * lineH - 3); ctx.lineTo(COL_RIGHT, (i + 1) * lineH - 3); ctx.stroke()
      ctx.font = `${HEADER_FONT_SIZE}px '${ARABIC_FONT_FAMILY}', serif`
      ctx.textAlign = 'center'
      const rawText = line.text.trim()
      const headerName = rawText.startsWith('سورة ') ? rawText : `سورة ${rawText}`
      ctx.fillText(headerName, IMG_W / 2, y)
      return
    }
    if (line.type === 'basmala') {
      ctx.font = `${HEADER_FONT_SIZE}px '${ARABIC_FONT_FAMILY}', serif`
      ctx.textAlign = 'center'
      ctx.fillText('بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ', IMG_W / 2, y)
      return
    }
    if (line.tokens.length === 0) return
    ctx.font = `${line.fs}px '${ARABIC_FONT_FAMILY}', serif`
    drawTokens(ctx, line.tokens, y, hidden, MEMO_PLACEHOLDER_COLOR, y)
  })

  drawMemoFooter(ctx, a, pageNum)
  return sliceQuadrants(canvas)
}

// ─── Memorisation footer with next-line preview (M1.2, Option C) ──────────────
//
//   y 0–252   five Quran lines exactly as in Reading Mode (lowest ink on any
//             page is y = 250.2, measured across all 1,810 sections)
//   y 253     separator (Reading Mode keeps its separator at y = 258)
//   y 254–287 footer row, centre y = 272.5:
//     x 14–93    LEFT  zone: stage dots (دروس) / revealed÷total / ✓
//     x 102–474  PREVIEW: next Quran text line, Uthmanic Hafs 16 px, centred;
//                in M1.2-B its words take part in hiding and recall
//     x 483–562  RIGHT zone: section n/total + activity label
//   The page number is omitted here during memorisation (shown on the phone).
const MEMO_SEPARATOR_Y   = 253
const MEMO_FOOTER_Y      = 272.5
const PREVIEW_FONT_SIZE  = 16
const PREVIEW_MIN_FONT   = 12
const PREVIEW_MAX_W      = 372        // 102–474, centred on x = 288
const PREVIEW_COLOR      = '#8a8a8a'  // dimmer than status (#aaa) and Quran text (#fff)
const PREVIEW_PLACEHOLDER_COLOR = '#666'
const ZONE_W             = 79         // side zones: 14–93 and 483–562
const ZONE_RULE_COLOR    = '#444'
const ZONE_RULE_H        = 16
const STAGE_DOT_R        = 3
const STAGE_DOT_STEP     = 10

/** Set the largest font ≤ `size` (down to `min`) at which `text` fits `maxW`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, size: number, min: number, maxW: number): void {
  let fs = size
  ctx.font = `${fs}px ${family}`
  while (ctx.measureText(text).width > maxW && fs > min) { fs--; ctx.font = `${fs}px ${family}` }
}

/**
 * Preview tokens laid out as the centred line Reading-style text would be:
 * fitted font, natural word spacing, right-to-left from the centred right edge.
 */
function layoutPreview(ctx: CanvasRenderingContext2D, pv: PreviewModel): PlacedToken[] {
  fitFont(ctx, pv.text, `'${ARABIC_FONT_FAMILY}', serif`, PREVIEW_FONT_SIZE, PREVIEW_MIN_FONT, PREVIEW_MAX_W)
  const space = ctx.measureText(' ').width
  const widths = pv.tokens.map(t => ctx.measureText(t.text).width)
  const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, widths.length - 1)
  let x = IMG_W / 2 + total / 2
  return pv.tokens.map((t, i) => { x -= widths[i]; const p = { ...t, x, w: widths[i] }; x -= space; return p })
}

/** Footer: progress (left) · next-line preview (centre) · section + activity (right). */
function drawMemoFooter(ctx: CanvasRenderingContext2D, a: ActiveSession, pageNum: number): void {
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1
  // +0.5 puts the 1 px line exactly on pixel row 253 (an integer y would blur it over rows 252–253)
  ctx.beginPath(); ctx.moveTo(COL_LEFT, MEMO_SEPARATOR_Y + 0.5); ctx.lineTo(COL_RIGHT, MEMO_SEPARATOR_Y + 0.5); ctx.stroke()
  const y = MEMO_FOOTER_Y
  ctx.textBaseline = 'middle'

  // Preview: the next Quran text line, verbatim, never truncated; hidden words → placeholders
  const pv = sessionPreview(a)
  if (pv) {
    const tokens = layoutPreview(ctx, pv)
    ctx.fillStyle = PREVIEW_COLOR
    ctx.direction = 'rtl'
    drawTokens(ctx, tokens, y, id => sessionHidden(a, id), PREVIEW_PLACEHOLDER_COLOR, y)
  }

  // Thin rules separating the side zones from the preview
  ctx.strokeStyle = ZONE_RULE_COLOR; ctx.lineWidth = 1
  for (const x of [COL_LEFT + ZONE_W + 4.5, COL_RIGHT - ZONE_W - 4.5]) {
    ctx.beginPath(); ctx.moveTo(x, y - ZONE_RULE_H / 2); ctx.lineTo(x, y + ZONE_RULE_H / 2); ctx.stroke()
  }

  ctx.fillStyle = FOOTER_COLOR; ctx.strokeStyle = FOOTER_COLOR
  const page = sessionPage(a)
  const showDots = a.kind === 'lesson' && a.flow.phase === 'memo'
  // Left zone: stage dots, or revealed/total (✓ when the section or page is complete)
  if (showDots) {
    for (let k = 0; k < MAX_STAGE; k++) {
      ctx.beginPath(); ctx.arc(COL_LEFT + STAGE_DOT_R + 1 + k * STAGE_DOT_STEP, y, STAGE_DOT_R, 0, Math.PI * 2)
      if (k < a.flow.stage) ctx.fill()
      else { ctx.lineWidth = 1; ctx.stroke() }
    }
  } else {
    const { revealed, total } = a.kind === 'lesson'
      ? flowProgress(a.flow)
      : { revealed: revealedCount(a.s), total: page.words.length }
    const doneMark = a.kind === 'lesson' && (a.flow.phase === 'done' || a.flow.phase === 'complete') ? '✓' : ''
    const count = `${doneMark}${toArabicNumerals(revealed)}/${toArabicNumerals(total)}`
    fitFont(ctx, count, 'monospace', FOOTER_FONT_SIZE, FOOTER_MIN_FONT_SIZE, ZONE_W)
    ctx.textAlign = 'left'; ctx.direction = 'ltr'
    ctx.fillText(count, COL_LEFT, y)
  }
  // Right zone: section n/total (left part) and activity label (right part)
  ctx.font = `${FOOTER_FONT_SIZE}px monospace`
  ctx.textAlign = 'left'; ctx.direction = 'ltr'
  ctx.fillText(`${toArabicNumerals(sessionSection(a) + 1)}/${toArabicNumerals(page.sectionCount)}`, COL_RIGHT - ZONE_W, y)
  ctx.font = `${FOOTER_FONT_SIZE}px '${ARABIC_FONT_FAMILY}', serif`
  ctx.textAlign = 'right'; ctx.direction = 'rtl'
  ctx.fillText(showDots ? 'دروس' : 'تسطير', COL_RIGHT, y)
}

async function _doRenderMemoView(): Promise<void> {
  const gen = renderGeneration
  await ensureFontLoaded()
  if (gen !== renderGeneration || !memo) return
  const quads = renderMemoQuads(memo, currentPage)
  if (gen !== renderGeneration) return
  await sendQuads(quads)
}

function renderMemoView(): void {
  enqueueRender(async () => {
    try { await _doRenderMemoView() }
    catch (e: any) { console.error('[Noor] Memo render error:', e) }
  })
}

/** Plain summary of the session, for logs, the phone panels and tests. */
function memoState() {
  if (!memo) return null
  const page = sessionPage(memo)
  if (memo.kind === 'lesson') {
    const f = memo.flow, pr = flowProgress(f)
    return { activity: 'lesson' as const, phase: f.phase, k: f.k, stage: f.stage, index: f.index, recallIndex: f.index,
      section: f.section, sectionCount: page.sectionCount, revealed: pr.revealed, total: pr.total,
      words: page.words.length, seed: f.seed }
  }
  const s = memo.s
  return { activity: 'tasteer' as const, phase: s.phase, k: s.section, stage: s.stage, index: s.recallIndex, recallIndex: s.recallIndex,
    section: s.section, sectionCount: page.sectionCount, revealed: revealedCount(s), total: page.words.length,
    words: page.words.length, seed: s.seed }
}

function logMemo(action: string): void {
  const st = memoState()
  if (!st) return
  console.log(`[Noor][memo] ${action} → ${st.activity} phase=${st.phase} section=${st.k + 1}/${st.sectionCount} ` +
    `stage=${st.stage} progress=${st.revealed}/${st.total} view=${st.section + 1}`)
}

/**
 * Start a fresh session on the current page. Always builds new state (new seed,
 * stage 0 / recall 0, cleared debounce and cooldowns), so nothing carries over
 * from a previous session or activity.
 *   'lesson'  (دروس): structured flow from `section` (user entry points: section 1)
 *   'tasteer' (تسطير): page-wide recall with every eligible word hidden, first section
 */
function startActivity(activity: Activity, seed?: number, section = 0): void {
  const page = buildMemoPage(getPage(currentPage).lines)
  const exercises = buildExercises(n => getPage(n).lines, page, currentPage, TOTAL_PAGES)
  const sessionSeed = (seed ?? (Date.now() ^ (currentPage * 2654435761))) >>> 0
  memo = activity === 'tasteer'
    ? { kind: 'tasteer', s: startTasteer(page, sessionSeed), exercises }
    : { kind: 'lesson', flow: startFlow(page, exercises, sessionSeed, section) }
  mode = 'memo'
  lastNavTime = {}
  boundaryUntil = {}
  console.log(`[Noor][memo] start activity=${activity} page=${currentPage} seed=${sessionSeed} ` +
    `words=${page.words.length} sections=${page.sectionCount}`)
  renderMemoView()
}

/** Glasses selector row: the structured دروس flow on the current page, from section 1. */
function startMemo(seed?: number): void {
  startActivity('lesson', seed, 0)
}

function exitMemo(): void {
  if (memo) currentScreen = sessionSection(memo)
  memo = null
  mode = 'reading'
  console.log(`[Noor][memo] exit → reading page=${currentPage} screen=${currentScreen}`)
  saveBookmark()
  renderReadingView()
}

/** Kind of state the lesson flow is in; crossing a boundary starts a cooldown. */
function boundaryKey(a: ActiveSession | null): string {
  return a && a.kind === 'lesson' ? `${a.flow.phase}:${a.flow.k}` : ''
}
let boundaryUntil: Record<number, number> = {}

/** Apply one forward/back step to the active session (shared by gestures and test hooks). */
function stepMemo(dir: 'advance' | 'back'): 'moved' | 'exit' | 'none' {
  if (!memo) return 'none'
  if (memo.kind === 'lesson') {
    if (dir === 'advance') {
      const next = flowAdvance(memo.flow)
      if (next === memo.flow) return 'none'
      memo = { kind: 'lesson', flow: next }
      return 'moved'
    }
    const r = flowBack(memo.flow)
    if (r === 'exit') return 'exit'
    memo = { kind: 'lesson', flow: r }
    return 'moved'
  }
  if (dir === 'advance') { memo = { ...memo, s: memoAdvanceState(memo.s) }; return 'moved' }
  const r = memoBackState(memo.s)
  if (r === 'exit') return 'exit'
  memo = { ...memo, s: r }
  return 'moved'
}

/** A swipe in memo mode: debounce, boundary cooldown, one step, render. */
function memoSwipe(dir: 'advance' | 'back'): void {
  const key = dir === 'advance' ? 2 : 1
  const now = Date.now()
  if (now - (lastNavTime[key] ?? 0) < NAV_DEBOUNCE_MS) return
  if (now < (boundaryUntil[key] ?? 0)) { console.log(`[Noor][memo] ${dir} ignored (boundary cooldown)`); return }
  lastNavTime[key] = now
  const before = boundaryKey(memo)
  const r = stepMemo(dir)
  if (r === 'exit') { exitMemo(); return }
  if (r === 'none') return
  // Crossing into a new phase or section: hold further swipes in the same
  // direction briefly so a burst of input cannot skip DONE or a whole section.
  if (boundaryKey(memo) !== before) boundaryUntil[key] = now + BOUNDARY_COOLDOWN_MS
  logMemo(dir)
  renderMemoView()
}

/** SCROLL_BOTTOM_EVENT in memo mode. */
function memoAdvance(): void { memoSwipe('advance') }

/** SCROLL_TOP_EVENT in memo mode. */
function memoBack(): void { memoSwipe('back') }

/** Single press in memo mode: no action in the structured دروس flow; next section in standalone تسطير. */
function memoTap(): void {
  if (!memo) return
  if (memo.kind === 'lesson') { console.log('[Noor][memo] tap ignored in structured دروس'); return }
  if (Date.now() - selectorConfirmedAt <= CONFIRM_COOLDOWN_MS) return
  memo = { ...memo, s: memoNextSectionState(memo.s) }
  logMemo('next section')
  renderMemoView()
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function goNext(): void {
  const now = Date.now()
  if (now - (lastNavTime[2] ?? 0) < NAV_DEBOUNCE_MS) return
  lastNavTime[2] = now
  if (mode === 'selector') {
    if (selectorIndex < selectorItemCount() - 1) selectorIndex++
    renderSelectorView(); return
  }
  const pageData = getPage(currentPage)
  const maxScreen = screensForPage(pageData.lines) - 1
  if (currentScreen < maxScreen) {
    currentScreen++
  } else if (currentPage < TOTAL_PAGES) {
    currentPage++; currentScreen = 0
  } else return
  saveBookmark()
  renderReadingView()
}

function goPrev(): void {
  const now = Date.now()
  if (now - (lastNavTime[1] ?? 0) < NAV_DEBOUNCE_MS) return
  lastNavTime[1] = now
  if (mode === 'selector') {
    if (selectorIndex > 0) selectorIndex--
    renderSelectorView(); return
  }
  if (currentScreen > 0) {
    currentScreen--
  } else if (currentPage > 1) {
    currentPage--
    const pageData = getPage(currentPage)
    currentScreen = screensForPage(pageData.lines) - 1
  } else return
  saveBookmark()
  renderReadingView()
}

// ─── Event handling ───────────────────────────────────────────────────────────
function resolveEventType(event: any): number | null {
  const candidates = [
    event?.jsonData?.eventType,
    event?.textEvent?.eventType,
    event?.sysEvent?.eventType,   // G2 sends events via sysEvent
    event?.eventType,
    event?.data?.eventType,
  ]
  for (const raw of candidates) {
    if (raw === undefined || raw === null) continue
    const resolved = OsEventTypeList.fromJson(raw)
    if (resolved !== null && resolved !== undefined) return resolved as number
    if (typeof raw === 'number') return raw
  }
  // G2 single tap sends sysEvent/jsonData with eventSource but NO eventType field.
  // Treat this as CLICK_EVENT (0).
  if (
    (event?.sysEvent?.eventSource !== undefined || event?.jsonData?.eventSource !== undefined) &&
    event?.sysEvent?.eventType === undefined &&
    event?.jsonData?.eventType === undefined
  ) {
    return 0
  }
  return null
}

async function setupNavigation(): Promise<void> {
  const bridge = await getBridge()
  // Unsubscribe any previous listener before registering a new one
  if (_unsubNav) { try { _unsubNav() } catch (_) {} }
  _unsubNav = bridge.onEvenHubEvent((event: any) => {
    const eventType = resolveEventType(event)
    console.log('[Noor] event:', JSON.stringify(event), '→ type:', eventType, '| mode:', mode)
    if (eventType === null) return
    _dbgEventCount++
    _dbgLastEvent = eventType
    // If the user dismissed the exit popup and returned to the plugin,
    // reset all debounce timers on the first incoming event so swipes/taps
    // work immediately. The G2 may not send event type 4 on popup dismiss.
    if (_pendingResume) {
      _pendingResume = false
      lastEventTime  = 0
      lastNavTime    = {}
      _displayDirty  = true
      console.log('[Noor] Resume from popup — debounce timers reset')
      setTimeout(() => { resumeRender(); setTimeout(() => resumeRender(), 900) }, 400)
    }
    const now = Date.now()
    const inSelector = mode === 'selector'
    // Debounce only single taps (type 0) in reading mode.
    // Do NOT include double-tap (type 3) in the debounce — this was causing
    // the selector to fail: a double-tap set lastEventTime, then the next
    // single tap arrived within 350ms and was blocked by the debounce guard.
    if (eventType === 0 && !inSelector && (now - lastEventTime) < EVENT_DEBOUNCE_MS) return
    if (eventType === 0) lastEventTime = now
    if (mode === 'memo') {
      // Record which source produced which SDK event, for hardware mapping checks
      const source = event?.sysEvent?.eventSource ?? event?.jsonData?.eventSource
      console.log(`[Noor][memo] input eventType=${eventType} eventSource=${source ?? 'n/a'}`)
      if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) { memoAdvance(); return }
      if (eventType === OsEventTypeList.SCROLL_TOP_EVENT)    { memoBack(); return }
      if (eventType === OsEventTypeList.CLICK_EVENT)         { memoTap(); return }
      // Double tap and lifecycle events fall through to the existing handling
    }
    switch (eventType) {
      case 1:
        goPrev(); break
      case 2:
        goNext(); break
      case 0:
        // Single tap → enter selector (reading mode) / confirm selection (selector mode)
        if (mode === 'reading') {
          if (Date.now() - selectorConfirmedAt > CONFIRM_COOLDOWN_MS) enterSelector()
        } else if (mode === 'selector') {
          confirmSelector()
        }
        break
      case 3:
        // Double tap → exit plugin (reading mode) / cancel selector (selector mode)
        if (mode === 'selector') {
          mode = 'reading'
          renderReadingView()
        } else {
          // Show exit dialog on phone UI simultaneously with glasses popup.
          // If user taps No on phone → page reloads (recovers frozen JS thread).
          // If user taps Yes on phone → shutDownPageContainer(0) exits cleanly.
          // The glasses popup satisfies store compliance requirement.
          ;(window as any).__noorShowExitDialog?.()
          bridge.shutDownPageContainer(1)
        }
        break
      case 4:
        // Foreground resume — user returned from background or dismissed popup.
        console.log('[Noor] Foreground resume — re-rendering')
        lastEventTime = 0
        lastNavTime   = {}
        _displayDirty = true
        setTimeout(() => {
          resumeRender()
          setTimeout(() => resumeRender(), 900)
        }, 600)
        break
      default:
        console.log('[Noor] Unhandled event type:', eventType)
    }
  })
}

// ─── Hard reset ──────────────────────────────────────────────────────────────
function hardReset(): void {
  _dbgResetCount++
  console.log('[Noor] Hard reset: bumping generation and scheduling re-render')
  // Bump generation synchronously — the stuck drainQueue will see this
  // on its next iteration (after its current sendImage timeout fires)
  // and exit cleanly.
  renderGeneration++
  const myGen = renderGeneration
  renderQueue = []
  renderRunning = false
  lastEventTime = 0
  lastNavTime   = {}
  _displayDirty = true
  _pendingResume = false
  // Schedule the re-render after 2s (worst case: 4 x 400ms sendImage timeouts)
  // Using plain setTimeout — no await — so the stuck coroutine cannot block this
  setTimeout(() => {
    if (myGen !== renderGeneration) return  // another reset happened
    renderQueue = []
    renderRunning = false
    renderGeneration++
    // Directly enqueue and start drainQueue — bypass enqueueRender's renderRunning check
    const fn = mode === 'reading'
      ? async () => { renderReadingView() }
      : mode === 'memo'
        ? async () => { renderMemoView() }
        : async () => { renderSelectorView() }
    renderQueue = [fn]
    drainQueue()
  }, 2000)
}
// ─── Entry point ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  try {
    console.log('[Noor] Starting v4.6.35 (full rendering, MUSHAF_DATA bundle, G2)…')
    const bridge = await getBridge()

    // Wait for launch source or timeout
    await new Promise<void>((resolve) => {
      const unsub = bridge.onLaunchSource(async () => {
        unsub()
        try { await loadBookmark() } catch (_) {}
        resolve()
      })
      setTimeout(() => resolve(), 2000)
    })

    await setupContainers()

    // Extra settle time before first render to avoid freeze on cold start
    await delay(300)

    // Three initial renders: T+0, T+0.9s, T+2s (matches Noor Azkar pattern)
    renderReadingView()
    setTimeout(() => renderReadingView(), 900)
    setTimeout(() => renderReadingView(), 2000)

    await setupNavigation()

    // 8-second heartbeat — keeps the display alive (matches Noor Azkar)
    setInterval(() => {
      if (_displayDirty) resumeRender()
    }, 8000)

    // Web Worker wake-up detection
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      let lastSeq = -1
      let wakeTimer: ReturnType<typeof setTimeout> | null = null
      worker.onmessage = (e: MessageEvent) => {
        const { seq } = e.data
        if (lastSeq >= 0 && seq - lastSeq > 1) {
          console.log(`[Noor] Worker detected suspension (seq gap ${seq - lastSeq}) — re-rendering`)
          if (wakeTimer) clearTimeout(wakeTimer)
          wakeTimer = setTimeout(() => { resumeRender(); wakeTimer = null }, 500)
        }
        lastSeq = seq
      }
      worker.onerror = (err) => console.warn('[Noor] Worker error:', err.message)
    } catch (e) {
      console.warn('[Noor] Web Worker not supported, falling back to focus event')
      window.addEventListener('focus', () => setTimeout(() => resumeRender(), 500))
    }

    console.log('[Noor] Ready. Page', currentPage, 'screen', currentScreen)
  } catch (e: any) {
    console.error('[Noor] Fatal:', e)
  }
}

main()

// ─── Developer API ────────────────────────────────────────────────────────────
;(window as any).__noorShowExitDialog = null  // set by phone UI
;(window as any).noor = {
  jumpToPage: (n: number) => {
    currentPage = Math.max(1, Math.min(TOTAL_PAGES, n))
    currentScreen = 0; currentSurahNum = 0; mode = 'reading'; memo = null; saveBookmark(); renderReadingView()
  },
  jumpToSurah: (n: number) => {
    const s = SURAHS.find(([num]) => num === n)
    if (!s) return
    currentPage = s[2]; currentSurahNum = n; mode = 'reading'; memo = null
    const pageData = getPage(s[2])
    currentScreen = screenForSurahHeader(pageData.lines, n)
    saveBookmark(); renderReadingView()
  },
  goNext, goPrev,
  // Phone auto-advance must not move the page under an active دروس/تسطير session
  nextScreen: () => { if (mode !== 'memo') goNext() },
  refresh: () => {
    // Inline hardReset — prevents Vite tree-shaking
    _dbgResetCount++
    renderGeneration++
    const myGen = renderGeneration
    renderQueue = []
    renderRunning = false
    lastEventTime = 0
    lastNavTime   = {}
    _displayDirty = true
    _pendingResume = false
    setTimeout(() => {
      if (myGen !== renderGeneration) return
      renderQueue = []
      renderRunning = false
      renderGeneration++
      resumeRender()
      if (!renderRunning) drainQueue()
    }, 2000)
  },
  // Memorisation test hooks (bypass gesture debounce; used by automated tests)
  /** Phone UI: start دروس (stage 0) / تسطير (all hidden) on the current page; end either. */
  startLesson:  (seed?: number) => startActivity('lesson', seed, 0),
  startTasteer: (seed?: number) => startActivity('tasteer', seed, 0),
  endActivity:  () => { if (mode === 'memo') exitMemo() },
  memo: {
    /** Test hook: structured دروس flow starting at the current screen's section. */
    start: (seed?: number) => startActivity('lesson', seed, currentScreen),
    // Test hooks bypass the gesture debounce and boundary cooldown
    advance: () => { if (stepMemo('advance') === 'moved') renderMemoView() },
    back: () => { const r = stepMemo('back'); if (r === 'exit') exitMemo(); else if (r === 'moved') renderMemoView() },
    tap: () => memoTap(),
    /** The preview line shown for the displayed section (for automated checks). */
    preview: () => { const pv = memo && sessionPreview(memo); return pv && { page: pv.page, line: pv.line, text: pv.text } },
    /** Token boxes of the displayed section (for automated pixel checks). */
    layout: () => {
      if (!memo) return null
      const a = memo
      const [, ctx] = makeCanvas(IMG_W, IMG_H)
      return layoutMemoSection(ctx, sessionPage(a), sessionSection(a)).flatMap(l => l.tokens.map(t => ({
        role: t.role, word: t.word, x: t.x, w: t.w, y: l.y, fs: l.fs,
        hidden: t.role === 'word' && sessionHidden(a, t.word),
      })))
    },
    /** Preview token boxes with their hidden state (for automated pixel checks). */
    previewLayout: () => {
      const a = memo, pv = a && sessionPreview(a)
      if (!a || !pv) return null
      const [, ctx] = makeCanvas(IMG_W, IMG_H)
      return layoutPreview(ctx, pv).map(t => ({ role: t.role, word: t.word, x: t.x, w: t.w, text: t.text,
        hidden: t.role === 'word' && sessionHidden(a, t.word) }))
    },
    get state() { return memoState() },
  },
  get page()         { return currentPage },
  get screen()        { return currentScreen },
  get mode()          { return mode },
  get surahNum()      { return currentSurahNum },
  get totalScreens()  {
    const pageData = getPage(currentPage)
    return screensForPage(pageData.lines)
  },
  exit: () => getBridge().then(b => b.shutDownPageContainer(0)),
  reregister: () => {
    _dbgResetCount++
    renderGeneration++
    const myGen2 = renderGeneration
    renderQueue = []
    renderRunning = false
    lastEventTime = 0
    lastNavTime   = {}
    _displayDirty = true
    _pendingResume = false
    setTimeout(() => {
      if (myGen2 !== renderGeneration) return
      renderQueue = []
      renderRunning = false
      renderGeneration++
      resumeRender()
      if (!renderRunning) drainQueue()
    }, 2000)
  },
}
