// Generates public/icon.png. An IWA manifest must carry at least one valid
// icon or the install is rejected, and we'd rather not commit a binary blob
// whose provenance nobody can check — so we synthesize it.
//
//   node scripts/make-icon.mjs
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const SIZE = 512
const BG = [0x1a, 0x1a, 0x1a] // matches the app's dark --bg
const FG = [0x1a, 0x8f, 0xff] // --accent

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

// A rounded-ish glyph: a filled square with a lighter inset block, enough to
// read as an app icon at small sizes without shipping a design asset.
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1))
let o = 0
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const inset = x > SIZE * 0.28 && x < SIZE * 0.72 && y > SIZE * 0.2 && y < SIZE * 0.8
    const bar = inset && y > SIZE * 0.45 && y < SIZE * 0.55
    const c = inset && !bar ? FG : BG
    raw[o++] = c[0]
    raw[o++] = c[1]
    raw[o++] = c[2]
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // colour type: truecolour
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
const out = new URL('../public/icon.png', import.meta.url)
writeFileSync(out, png)
console.log(`wrote ${out.pathname} (${SIZE}x${SIZE}, ${png.length} bytes)`)
