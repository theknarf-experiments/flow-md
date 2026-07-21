// Generates public/favicon.png. The app had no favicon at all, which shows
// up as a blank page icon in browser tabs — and as an empty tile in the IWA
// shell's pinned grid. Synthesized rather than committed as an opaque blob.
//
//   node scripts/make-favicon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

const SIZE = 256
const BG = [0x1a, 0x1a, 0x1a] // --bg
const FG = [0x1a, 0x8f, 0xff] // --accent

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

// Three stacked bars — a note, at 16px.
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1))
let o = 0
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const inX = x > SIZE * 0.22 && x < SIZE * 0.78
    const band = (top, bottom, right) =>
      inX && x < SIZE * right && y > SIZE * top && y < SIZE * bottom
    const on = band(0.24, 0.36, 0.78) || band(0.44, 0.56, 0.68) || band(0.64, 0.76, 0.56)
    const c = on ? FG : BG
    raw[o++] = c[0]
    raw[o++] = c[1]
    raw[o++] = c[2]
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // truecolour
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
const out = new URL('../public/favicon.png', import.meta.url)
writeFileSync(out, png)
console.log(`wrote ${out.pathname} (${SIZE}x${SIZE}, ${png.length} bytes)`)
