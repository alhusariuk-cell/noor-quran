import { createCanvas, registerFont } from 'canvas'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

registerFont('/home/ubuntu/noor-quran/public/fonts/UthmanicHafs.woff2', { family: 'UthmanicHafs' })

const canvas = createCanvas(600, 200)
const ctx = canvas.getContext('2d')
ctx.font = "18px 'UthmanicHafs', serif"

function stripWaqf(t) {
  return t.replace(/[\u06DF-\u06E8\u06EA-\u06ED\u0600-\u0605]/g, '')
}

let maxWidth = 0
let maxLine = ''
let maxPage = 0

const dir = '/home/ubuntu/noor-quran/public/mushaf'
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()

for (const file of files) {
  const pageNum = parseInt(file.replace('page-', '').replace('.json', ''))
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  for (const line of data.lines) {
    if (line.type !== 'text') continue
    const text = stripWaqf(
      line.words && line.words.length > 0
        ? line.words.map(w => w.word).join(' ')
        : (line.text || '')
    )
    const w = ctx.measureText(text).width
    if (w > maxWidth) {
      maxWidth = w
      maxLine = text
      maxPage = pageNum
    }
  }
}

console.log(`Max text width: ${maxWidth.toFixed(1)}px`)
console.log(`Page: ${maxPage}`)
console.log(`Line: ${maxLine.substring(0, 60)}`)
console.log(`\nDisplay width: 576px`)
console.log(`Suggested column width: ${Math.ceil(maxWidth / 10) * 10}px`)
console.log(`Margin each side: ${((576 - Math.ceil(maxWidth / 10) * 10) / 2).toFixed(1)}px`)
