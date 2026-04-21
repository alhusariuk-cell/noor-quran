/**
 * Noor – Quran Reader for Even Realities G2 Smart Glasses  (v4.0.0)
 *
 * ─── Rendering approach ───────────────────────────────────────────────────────
 * Arabic text is rendered on the phone via HTML5 Canvas + Uthmanic Hafs font
 * and sent as PNG pixel data.  No pre-rendered tiles — the entire plugin is
 * ~2 MB (604 JSON page files + font) vs 63 MB for the tile-based v3.x.
 *
 * ─── G2 display layout ────────────────────────────────────────────────────────
 *   Physical display: 576 × 288 px
 *   Canvas: 400 × 200 px, centred at offset (88, 44)
 *   4 image containers in a 2×2 grid, each 200 × 100 px:
 *     TL (88, 44)   TR (288, 44)
 *     BL (88, 144)  BR (288, 144)
 *
 * ─── Modes ────────────────────────────────────────────────────────────────────
 *   READING  – 5 lines of Quranic text per screen, 3 screens per page
 *   SELECTOR – surah picker, 7 rows visible, one highlighted
 *
 * ─── Navigation ───────────────────────────────────────────────────────────────
 *   READING mode:
 *     Swipe forward  → next screen / next page
 *     Swipe back     → previous screen / previous page
 *     Double tap     → enter SELECTOR mode
 *
 *   SELECTOR mode:
 *     Swipe forward  → highlight next surah
 *     Swipe back     → highlight previous surah
 *     Double tap     → confirm → jump to highlighted surah → READING
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

// ─── G2 display constants ─────────────────────────────────────────────────────

const DISPLAY_W    = 576
const DISPLAY_H    = 288
const IMG_W        = 400          // canvas width  (2 × QUAD_W)
const IMG_H        = 200          // canvas height (2 × QUAD_H)
const QUAD_W       = 200
const QUAD_H       = 100
const IMG_OFFSET_X = (DISPLAY_W - IMG_W) / 2   // 88
const IMG_OFFSET_Y = (DISPLAY_H - IMG_H) / 2   // 44

// ─── Layout zones within the 400×200 canvas ──────────────────────────────────
//
//   Text area:  y 0  – 174  (174 px for 5 lines)
//   Separator:  y 175
//   Footer:     y 176 – 199 (24 px)
//
const TEXT_AREA_H      = 174
const FOOTER_H         = IMG_H - TEXT_AREA_H   // 26 px
const LINES_PER_SCREEN = 5

// ─── Typography ───────────────────────────────────────────────────────────────

const ARABIC_FONT_URL    = '/fonts/UthmanicHafs.woff2'
const ARABIC_FONT_FAMILY = 'UthmanicHafs'
const TEXT_FONT_SIZE     = 20    // px — slightly larger than v1.x thanks to taller canvas
const HEADER_FONT_SIZE   = 16    // surah-header / basmala

// Text column — slightly narrower than full canvas to leave breathing room
const TEXT_COL_W  = 380
const COL_LEFT    = (IMG_W - TEXT_COL_W) / 2   // 10
const COL_RIGHT   = COL_LEFT + TEXT_COL_W       // 390

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
const SELECTOR_VISIBLE = 7   // more rows now that we have 174px of text area

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
  getBridge().then(b =>
    b.setLocalStorage(BOOKMARK_KEY, JSON.stringify({ page: currentPage, screen: currentScreen }))
  ).catch(() => {})
}

async function loadBookmark(): Promise<void> {
  try {
    const bridge = await getBridge()
    const raw = await bridge.getLocalStorage(BOOKMARK_KEY)
    if (!raw) return
    const { page, screen } = JSON.parse(raw)
    if (typeof page === 'number' && page >= 1 && page <= TOTAL_PAGES) {
      currentPage   = page
      currentScreen = typeof screen === 'number' ? screen : 0
    }
  } catch (_) {}
}

// ─── Render queue ─────────────────────────────────────────────────────────────

let renderQueue: (() => Promise<void>)[] = []
let renderRunning = false
let renderGeneration = 0

function enqueueRender(fn: () => Promise<void>): void {
  renderGeneration++
  renderQueue = [fn]
  if (!renderRunning) drainQueue()
}

async function drainQueue(): Promise<void> {
  renderRunning = true
  while (renderQueue.length > 0) {
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
let lastSwipeTime       = 0

const EVENT_DEBOUNCE_MS   = 350
const NAV_DEBOUNCE_MS     = 400
const SWIPE_DEBOUNCE_MS   = 400
const CONFIRM_COOLDOWN_MS = 600

const pageCache = new Map<number, MushafPage>()
const CACHE_SIZE = 7

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

// ─── Data ─────────────────────────────────────────────────────────────────────

async function fetchPage(n: number): Promise<MushafPage> {
  if (pageCache.has(n)) return pageCache.get(n)!
  const resp = await fetch(`/mushaf/page-${String(n).padStart(3, '0')}.json`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for page ${n}`)
  const data: MushafPage = await resp.json()
  if (pageCache.size >= CACHE_SIZE) pageCache.delete(pageCache.keys().next().value!)
  pageCache.set(n, data)
  return data
}

function prefetchAdjacentPages(n: number): void {
  if (n + 1 <= TOTAL_PAGES && !pageCache.has(n + 1)) fetchPage(n + 1).catch(() => {})
  if (n - 1 >= 1           && !pageCache.has(n - 1)) fetchPage(n - 1).catch(() => {})
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

function canvasToPngBytes(canvas: HTMLCanvasElement): Uint8Array {
  const b64 = canvas.toDataURL('image/png').split(',')[1]
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Slice the 400×200 canvas into 4 quadrant PNGs (TL, TR, BL, BR) */
function sliceQuadrants(canvas: HTMLCanvasElement): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const quad = (sx: number, sy: number): Uint8Array => {
    const [t, tc] = makeCanvas(QUAD_W, QUAD_H)
    tc.drawImage(canvas, sx, sy, QUAD_W, QUAD_H, 0, 0, QUAD_W, QUAD_H)
    return canvasToPngBytes(t)
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
 * on the glasses display.  Waqf instruction marks are kept.
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
 * Render 5 lines of Quranic text onto a 400×200 canvas with a footer bar,
 * then slice into 4 quadrant tiles.
 *
 * Text is justified within TEXT_COL_W using RTL word-gap distribution.
 */
function renderLinesToQuads(
  lines: MushafLine[],
  screenIdx: number,
  totalScreens: number,
  pageNum: number,
  surahName: string
): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
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
      // Use the raw header text from the mushaf data — it already contains
      // the correct سورة name in the correct Uthmanic spelling.
      // Strip any leading سورة prefix so we can re-add it consistently.
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
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(COL_LEFT, TEXT_AREA_H); ctx.lineTo(COL_RIGHT, TEXT_AREA_H); ctx.stroke()

  const footerY = TEXT_AREA_H + FOOTER_H / 2
  ctx.textBaseline = 'middle'

  // Left: page number
  ctx.fillStyle = '#888'; ctx.font = '11px monospace'
  ctx.textAlign = 'left'; ctx.direction = 'ltr'
  ctx.fillText(`ص${toArabicNumerals(pageNum)}`, COL_LEFT, footerY)

  // Centre: screen counter
  ctx.textAlign = 'center'
  ctx.fillText(`${toArabicNumerals(screenIdx + 1)}/${toArabicNumerals(totalScreens)}`, IMG_W / 2, footerY)

  // Right: surah name
  if (surahName) {
    ctx.fillStyle = '#888'
    ctx.font = `11px '${ARABIC_FONT_FAMILY}', serif`
    ctx.textAlign = 'right'; ctx.direction = 'rtl'
    ctx.fillText(surahName, COL_RIGHT, footerY)
  }

  return sliceQuadrants(canvas)
}

// ─── Selector mode rendering ──────────────────────────────────────────────────

function renderSelectorQuads(): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const [canvas, ctx] = makeCanvas(IMG_W, IMG_H)
  const rowH = Math.floor(TEXT_AREA_H / SELECTOR_VISIBLE)
  const half  = Math.floor(SELECTOR_VISIBLE / 2)
  const start = Math.max(0, Math.min(selectorIndex - half, SURAHS.length - SELECTOR_VISIBLE))
  const visible = SURAHS.slice(start, start + SELECTOR_VISIBLE)

  visible.forEach(([num, name], i) => {
    const isActive = start + i === selectorIndex
    const y    = i * rowH
    const midY = y + rowH / 2

    if (isActive) {
      ctx.fillStyle = '#222'
      ctx.fillRect(COL_LEFT, y, TEXT_COL_W, rowH)
    }

    // Surah number
    ctx.fillStyle = isActive ? '#fff' : '#666'
    ctx.font = `${isActive ? 13 : 11}px monospace`
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.direction = 'ltr'
    ctx.fillText(String(num).padStart(3, ' '), COL_LEFT + 4, midY)

    // Surah name
    ctx.direction = 'rtl'; ctx.textAlign = 'right'
    ctx.font = `${isActive ? 19 : 15}px '${ARABIC_FONT_FAMILY}', serif`
    ctx.fillStyle = isActive ? '#fff' : '#888'
    ctx.fillText(name, COL_RIGHT - 4, midY)
  })

  // Footer
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(COL_LEFT, TEXT_AREA_H); ctx.lineTo(COL_RIGHT, TEXT_AREA_H); ctx.stroke()
  const footerY = TEXT_AREA_H + FOOTER_H / 2
  ctx.fillStyle = '#555'; ctx.font = '10px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'ltr'
  ctx.fillText('swipe: scroll   2× tap: select', IMG_W / 2, footerY)

  return sliceQuadrants(canvas)
}

// ─── SDK helpers ──────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function sendImage(id: number, name: string, data: Uint8Array): Promise<void> {
  const bridge = await getBridge()
  await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: id, containerName: name, imageData: data }))
}

async function sendQuads(tiles: [Uint8Array, Uint8Array, Uint8Array, Uint8Array]): Promise<void> {
  const [tl, tr, bl, br] = tiles
  await Promise.all([
    sendImage(1, 'quad_tl', tl),
    sendImage(2, 'quad_tr', tr),
    sendImage(3, 'quad_bl', bl),
    sendImage(4, 'quad_br', br),
  ])
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
 * given surah number.  The header line carries a `surah` field (e.g. "082");
 * we match on that to avoid the case where two surahs share a page and the
 * first header found belongs to the *following* surah (e.g. page 587 has
 * only المطففين's header, not الانفطار's).
 *
 * Falls back to screen 0 when no matching header is found.
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
  // No matching header found — surah starts before any header on this page
  return 0
}

async function _doRenderReadingView(): Promise<void> {
  const gen = renderGeneration
  await ensureFontLoaded()
  const pageData = await fetchPage(currentPage)
  const lines    = pageData.lines
  const start    = currentScreen * LINES_PER_SCREEN
  const slice    = [...lines.slice(start, start + LINES_PER_SCREEN)]
  while (slice.length < LINES_PER_SCREEN) slice.push({ line: -1, type: 'text', text: '' })

  // Derive the surah name for the footer.
  // Always use the SURAHS array (no سورة prefix, consistent) rather than raw
  // header text from the mushaf data (which includes سورة and may belong to
  // the next surah on shared pages).
  const surahName = surahNameForPage(currentPage)

  const quads = renderLinesToQuads(slice, currentScreen, screensForPage(lines), currentPage, surahName)
  if (gen !== renderGeneration) return
  await sendQuads(quads)
  prefetchAdjacentPages(currentPage)
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
  // Find the correct screen asynchronously, then render
  fetchPage(page).then(pageData => {
    currentScreen = screenForSurahHeader(pageData.lines, surahNum)
    saveBookmark()
    renderReadingView()
  }).catch(() => {
    currentScreen = 0
    saveBookmark()
    renderReadingView()
  })
}

// ─── Navigation ───────────────────────────────────────────────────────────────

async function goNext(): Promise<void> {
  const now = Date.now()
  if (now - (lastNavTime[2] ?? 0) < NAV_DEBOUNCE_MS) return
  lastNavTime[2] = now
  if (mode === 'selector') {
    if (selectorIndex < SURAHS.length - 1) selectorIndex++
    renderSelectorView(); return
  }
  const pageData = await fetchPage(currentPage)
  const maxScreen = screensForPage(pageData.lines) - 1
  if (currentScreen < maxScreen) {
    currentScreen++
  } else if (currentPage < TOTAL_PAGES) {
    currentPage++; currentScreen = 0
  } else return
  saveBookmark()
  renderReadingView()
}

async function goPrev(): Promise<void> {
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
    const pageData = await fetchPage(currentPage)
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
    event?.eventType,
    event?.data?.eventType,
  ]
  for (const raw of candidates) {
    if (raw === undefined || raw === null) continue
    const resolved = OsEventTypeList.fromJson(raw)
    if (resolved !== null && resolved !== undefined) return resolved as number
    if (typeof raw === 'number') return raw
  }
  return null
}

async function setupNavigation(): Promise<void> {
  const bridge = await getBridge()
  bridge.onEvenHubEvent((event: any) => {
    const eventType = resolveEventType(event)
    console.log('[Noor] event:', JSON.stringify(event), '→ type:', eventType, '| mode:', mode)
    if (eventType === null) return

    const now = Date.now()
    const isTap = eventType === 0 || eventType === 3
    const inSelector = mode === 'selector'
    if (isTap && !inSelector && (now - lastEventTime) < EVENT_DEBOUNCE_MS) return
    if (isTap) lastEventTime = now

    switch (eventType) {
      case 1: {
        const swipeNow = Date.now()
        if (swipeNow - lastSwipeTime < SWIPE_DEBOUNCE_MS) break
        lastSwipeTime = swipeNow
        goPrev(); break
      }
      case 2: {
        const swipeNow = Date.now()
        if (swipeNow - lastSwipeTime < SWIPE_DEBOUNCE_MS) break
        lastSwipeTime = swipeNow
        goNext(); break
      }
      case 0:
        break  // single tap — no-op
      case 3:
        if (mode === 'reading') {
          if (Date.now() - selectorConfirmedAt > CONFIRM_COOLDOWN_MS) enterSelector()
        } else if (mode === 'selector') {
          confirmSelector()
        }
        break
      case 4:
        console.log('[Noor] Foreground resume — re-rendering')
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

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    console.log('[Noor] Starting v4.0.0 (text rendering, G2)…')
    const bridge = await getBridge()

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
    renderReadingView()
    await setupNavigation()

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
;(window as any).noor = {
  jumpToPage: (n: number) => {
    currentPage = Math.max(1, Math.min(TOTAL_PAGES, n))
    currentScreen = 0; currentSurahNum = 0; mode = 'reading'; saveBookmark(); renderReadingView()
  },
  jumpToSurah: (n: number) => {
    const s = SURAHS.find(([num]) => num === n)
    if (!s) return
    currentPage = s[2]; currentSurahNum = n; mode = 'reading'
    fetchPage(s[2]).then(pageData => {
      currentScreen = screenForSurahHeader(pageData.lines, n)
      saveBookmark(); renderReadingView()
    }).catch(() => {
      currentScreen = 0; saveBookmark(); renderReadingView()
    })
  },
  goNext, goPrev,
  nextScreen: () => goNext(),
  refresh: () => resumeRender(),
  get page()         { return currentPage },
  get screen()        { return currentScreen },
  get mode()          { return mode },
  get surahNum()      { return currentSurahNum },
  get totalScreens()  {
    // Return cached page line count if available, else estimate 3
    const cached = pageCache.get(currentPage)
    return cached ? Math.ceil(cached.lines.length / LINES_PER_SCREEN) : 3
  },
}
