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
type AppMode = 'reading' | 'selector'

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
function renderSelectorQuads(): [number[], number[], number[], number[]] {
  const [canvas, ctx] = makeCanvas(IMG_W, IMG_H)
  const rowH = Math.floor(TEXT_AREA_H / SELECTOR_VISIBLE)
  const half  = Math.floor(SELECTOR_VISIBLE / 2)
  const start = Math.max(0, Math.min(selectorIndex - half, SURAHS.length - SELECTOR_VISIBLE))
  const visible = SURAHS.slice(start, start + SELECTOR_VISIBLE)

  visible.forEach(([num, name], i) => {
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
  selectorIndex = closest
  mode = 'selector'
  renderSelectorView()
}

function confirmSelector(): void {
  const [surahNum, , page] = SURAHS[selectorIndex]
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

// ─── Navigation ───────────────────────────────────────────────────────────────
function goNext(): void {
  const now = Date.now()
  if (now - (lastNavTime[2] ?? 0) < NAV_DEBOUNCE_MS) return
  lastNavTime[2] = now
  if (mode === 'selector') {
    if (selectorIndex < SURAHS.length - 1) selectorIndex++
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
    currentScreen = 0; currentSurahNum = 0; mode = 'reading'; saveBookmark(); renderReadingView()
  },
  jumpToSurah: (n: number) => {
    const s = SURAHS.find(([num]) => num === n)
    if (!s) return
    currentPage = s[2]; currentSurahNum = n; mode = 'reading'
    const pageData = getPage(s[2])
    currentScreen = screenForSurahHeader(pageData.lines, n)
    saveBookmark(); renderReadingView()
  },
  goNext, goPrev,
  nextScreen: () => goNext(),
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
