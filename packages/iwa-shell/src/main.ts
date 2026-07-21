// IWA shell prototype.
//
// This exists to answer three questions before we commit to Controlled Frame
// as the canvas-browser primitive:
//
//   1. Do live pages survive a CSS-transformed canvas (pan/zoom)? This is the
//      thing Electron's supported WebContentsView *cannot* do, since those
//      views aren't DOM and are positioned from the main process.
//   2. Can we inject script into a guest and read its DOM back out? That's
//      the whole web-archive story — capture a page, write it into the vault,
//      then query it with Datalog.
//   3. Does partition="persist:…" keep guest storage across relaunches? That
//      backs per-space containers.
//
// Everything is plain TS with no runtime codegen, because an IWA's CSP is
// `script-src 'self' 'wasm-unsafe-eval'` — no eval, no new Function. The
// prototype has to obey the rules the real app will live under.

import type { ControlledFrame } from './controlled-frame.js'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const viewport = $<HTMLDivElement>('viewport')
const canvas = $<HTMLDivElement>('canvas')
const logEl = $<HTMLDivElement>('log')
const banner = $<HTMLDivElement>('banner')
const zoomEl = $<HTMLSpanElement>('zoom')
const urlInput = $<HTMLInputElement>('url')

function log(msg: string, kind: 'ok' | 'err' | '' = '') {
  const line = document.createElement('div')
  if (kind) line.className = kind
  line.textContent = msg
  logEl.prepend(line)
}

// ---------------------------------------------------------------- detection

/** Is <controlledframe> actually available, or are we in a plain tab? */
function detectControlledFrame(): { available: boolean; detail: string } {
  const el = document.createElement('controlledframe')
  const ctor = el.constructor?.name ?? 'unknown'
  if (el instanceof HTMLUnknownElement) {
    return { available: false, detail: `unknown element (${ctor})` }
  }
  const hasApi = typeof (el as ControlledFrame).executeScript === 'function'
  return {
    available: true,
    detail: `${ctor}${hasApi ? ' with executeScript' : ' (no executeScript yet)'}`,
  }
}

const cf = detectControlledFrame()
const isolated = window.crossOriginIsolated
const isIwa = location.protocol === 'isolated-app:'

if (!cf.available) {
  banner.hidden = false
  banner.textContent =
    `<controlledframe> unavailable — ${cf.detail}\n` +
    `origin: ${location.origin} · crossOriginIsolated: ${isolated}\n` +
    `Falling back to <iframe> so the canvas is still explorable.\n` +
    `For the real thing run: cargo run --manifest-path packages/iwa-launcher/Cargo.toml`
}
log(`controlledframe: ${cf.available ? 'available' : 'MISSING'} — ${cf.detail}`, cf.available ? 'ok' : 'err')
log(`origin ${location.origin} · isolated-app: ${isIwa} · crossOriginIsolated: ${isolated}`)

// ------------------------------------------------------------------- canvas

let panX = 40
let panY = 40
let scale = 1

function applyTransform() {
  canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`
  zoomEl.textContent = `${Math.round(scale * 100)}%`
}

viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    const rect = viewport.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    // Zoom about the cursor: keep the canvas point under the pointer fixed.
    const next = Math.min(3, Math.max(0.2, scale * Math.exp(-e.deltaY * 0.0015)))
    panX = mx - ((mx - panX) / scale) * next
    panY = my - ((my - panY) / scale) * next
    scale = next
    applyTransform()
  },
  { passive: false },
)

// Pan from the background only, so drags inside a guest page still reach it.
viewport.addEventListener('pointerdown', (e) => {
  if (e.target !== viewport) return
  const startX = e.clientX - panX
  const startY = e.clientY - panY
  viewport.classList.add('panning')
  const move = (ev: PointerEvent) => {
    panX = ev.clientX - startX
    panY = ev.clientY - startY
    applyTransform()
  }
  const up = () => {
    viewport.classList.remove('panning')
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
})

$<HTMLButtonElement>('reset').addEventListener('click', () => {
  panX = 40
  panY = 40
  scale = 1
  applyTransform()
})

// -------------------------------------------------------------------- cards

interface Card {
  el: HTMLDivElement
  frame: ControlledFrame | HTMLIFrameElement
  url: string
}

const cards: Card[] = []
let nextX = 0

function addCard(url: string, partition = 'persist:flow-md-space') {
  const el = document.createElement('div')
  el.className = 'card'
  el.style.left = `${nextX}px`
  el.style.top = `${(cards.length % 2) * 60}px`
  nextX += 520

  const header = document.createElement('header')
  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = url
  const reload = document.createElement('button')
  reload.textContent = '⟳'
  const close = document.createElement('button')
  close.textContent = '✕'
  header.append(title, reload, close)

  let frame: ControlledFrame | HTMLIFrameElement
  if (cf.available) {
    const f = document.createElement('controlledframe') as ControlledFrame
    // Partition must be set before src for it to take effect.
    f.setAttribute('partition', partition)
    f.setAttribute('src', url)
    frame = f
  } else {
    const f = document.createElement('iframe')
    f.src = url
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    frame = f
  }

  el.append(header, frame as unknown as Node)
  canvas.append(el)
  const card: Card = { el, frame, url }
  cards.push(card)

  reload.addEventListener('click', () => {
    const f = frame as ControlledFrame
    if (typeof f.reload === 'function') f.reload()
    else (frame as HTMLIFrameElement).src = url
  })
  close.addEventListener('click', () => {
    el.remove()
    cards.splice(cards.indexOf(card), 1)
  })

  // Drag a card by its header — in canvas space, so it tracks under zoom.
  header.addEventListener('pointerdown', (e) => {
    if (e.target !== header && e.target !== title) return
    const ox = e.clientX / scale - el.offsetLeft
    const oy = e.clientY / scale - el.offsetTop
    const move = (ev: PointerEvent) => {
      el.style.left = `${ev.clientX / scale - ox}px`
      el.style.top = `${ev.clientY / scale - oy}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })

  for (const ev of ['loadstop', 'loadcommit', 'loadabort', 'load'] as const) {
    frame.addEventListener(ev, () => log(`${ev}: ${url}`))
  }

  log(`added ${cf.available ? 'controlledframe' : 'iframe'} → ${url}`)
  return card
}

// --------------------------------------------------------- capture / probing

/** The archive smoke test: run script in the guest, read its DOM back. */
async function captureAll() {
  if (cards.length === 0) return log('nothing to capture', 'err')
  for (const card of cards) {
    const f = card.frame as ControlledFrame
    if (typeof f.executeScript !== 'function') {
      log(`capture ${card.url}: executeScript unavailable (iframe fallback?)`, 'err')
      continue
    }
    try {
      const result = await f.executeScript({
        code: 'JSON.stringify({ title: document.title, url: location.href, bytes: document.documentElement.outerHTML.length })',
      })
      log(`capture ${card.url} → ${JSON.stringify(result)}`, 'ok')
    } catch (err) {
      log(`capture ${card.url} failed: ${err instanceof Error ? err.message : String(err)}`, 'err')
    }
  }
}

/** Does the CSP actually stop runtime codegen?
 *
 *  This has to run from real page script. Probing it through DevTools or CDP
 *  gives a false positive, because console/`Runtime.evaluate` execution is
 *  deliberately exempt from CSP — it reports eval as allowed when the page
 *  itself cannot use it.
 *
 *  `AsyncFunction` is the one that decides flow-md's fate: @mdx-js/mdx's
 *  evaluate() builds the compiled module with it. */
function cspSelfTest() {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  const check = (label: string, fn: () => unknown) => {
    try {
      log(`csp ${label}: ALLOWED → ${String(fn())}`, 'err')
    } catch (e) {
      log(`csp ${label}: blocked (${e instanceof Error ? e.name : 'error'})`, 'ok')
    }
  }
  check('new Function', () => new Function('return 41+1')())
  check('AsyncFunction (what MDX uses)', () => typeof new AsyncFunction('return 1'))
  check('setTimeout("string")', () => {
    // Legacy string form is also codegen.
    ;(setTimeout as unknown as (s: string, n: number) => number)('void 0', 0)
    return 'scheduled'
  })
}

/** The API is young and moving; list what this build actually exposes. */
function inspectApi() {
  const el = document.createElement('controlledframe') as ControlledFrame
  const proto = Object.getPrototypeOf(el)
  const names = proto ? Object.getOwnPropertyNames(proto) : []
  log(`constructor: ${el.constructor?.name}`)
  log(`members (${names.length}): ${names.sort().join(', ')}`)
}

// --------------------------------------------------------------------- wire

$<HTMLButtonElement>('add').addEventListener('click', () => {
  const url = urlInput.value.trim()
  if (!url) return
  addCard(url)
  urlInput.value = ''
})
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $<HTMLButtonElement>('add').click()
})
$<HTMLButtonElement>('capture').addEventListener('click', () => void captureAll())
$<HTMLButtonElement>('inspect').addEventListener('click', inspectApi)

cspSelfTest()
applyTransform()

// Two starting frames: the partition probe, and a real site (does
// third-party content behave under CSS transforms?).
//
// The probe uses an absolute http:// URL on purpose. A Controlled Frame's
// src must be http/https/data — the IWA's own `isolated-app:` origin is not
// loadable into a guest, so a relative "/probe.html" silently resolves
// against isolated-app:// and leaves the frame on about:blank.
const PROBE = cf.available ? 'http://localhost:5193/probe.html' : '/probe.html'
addCard(PROBE)
addCard('https://example.com')
