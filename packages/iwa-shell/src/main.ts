// The IWA shell: a browser wrapper whose tabs we own.
//
// Chrome gives us one app window; everything inside it — the tab strip, the
// address bar, navigation, lifecycle — is ours, because each tab is a
// <controlledframe> we create and control. flow-md itself is just a tab: an
// ordinary page served by the local dev/serve process, so it keeps runtime
// MDX evaluation and everything else a normal web page can do. The strict
// IWA CSP applies only to *this* document, not to guests.
//
// Tabs stay loaded when inactive (visibility, not display) so switching is
// instant and page state survives.
//
// This shell contains no runtime codegen, because an IWA enforces
// `script-src 'self' 'wasm-unsafe-eval'` — see cspSelfTest().

import type { ControlledFrame } from './controlled-frame.js'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const banner = $<HTMLDivElement>('banner')
const tabstrip = $<HTMLDivElement>('tabstrip')
const content = $<HTMLElement>('content')
const logEl = $<HTMLDivElement>('log')
const urlInput = $<HTMLInputElement>('url')
const backBtn = $<HTMLButtonElement>('back')
const fwdBtn = $<HTMLButtonElement>('fwd')

/** Shared partition: tabs behave like one browser profile (logins persist).
 *  Per-space containers would just be a different persist: name. */
const PARTITION = 'persist:flow-md'
const HOME = 'http://localhost:4748/'

function log(msg: string, kind: 'ok' | 'err' | '' = '') {
  const line = document.createElement('div')
  if (kind) line.className = kind
  line.textContent = msg
  logEl.prepend(line)
}

// ---------------------------------------------------------------- detection

function detectControlledFrame(): { available: boolean; detail: string } {
  const el = document.createElement('controlledframe')
  const ctor = el.constructor?.name ?? 'unknown'
  if (el instanceof HTMLUnknownElement) {
    return { available: false, detail: `unknown element (${ctor})` }
  }
  return { available: true, detail: ctor }
}

const cf = detectControlledFrame()
if (!cf.available) {
  banner.hidden = false
  banner.textContent =
    `<controlledframe> unavailable — ${cf.detail}\n` +
    `Falling back to <iframe>; most sites will refuse to load.\n` +
    `Run: cargo run --release --manifest-path packages/iwa-launcher/Cargo.toml`
}
log(`controlledframe: ${cf.available ? cf.detail : 'MISSING'}`, cf.available ? 'ok' : 'err')
log(`origin ${location.origin} · crossOriginIsolated: ${window.crossOriginIsolated}`)

/** Proof the CSP really blocks runtime codegen. Must run from page script:
 *  DevTools/CDP evaluation is exempt from CSP and reports a false "allowed". */
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
  check('AsyncFunction', () => typeof new AsyncFunction('return 1'))
}

// --------------------------------------------------------------------- tabs

interface Tab {
  id: number
  frame: ControlledFrame | HTMLIFrameElement
  el: HTMLDivElement
  label: HTMLSpanElement
  url: string
  title: string
}

const tabs: Tab[] = []
let active: Tab | null = null
let seq = 0

const isCF = (f: Tab['frame']): f is ControlledFrame => cf.available

function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return HOME
  if (/^https?:\/\//i.test(s)) return s
  // Looks like a host or path → http; otherwise treat as a search.
  if (/^[\w.-]+(:\d+)?(\/|$)/.test(s)) return `http://${s}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
}

function newTab(url = HOME, activate = true): Tab {
  const id = ++seq

  let frame: ControlledFrame | HTMLIFrameElement
  if (cf.available) {
    const f = document.createElement('controlledframe') as ControlledFrame
    // partition must be set before src to take effect
    f.setAttribute('partition', PARTITION)
    f.setAttribute('src', url)
    frame = f
  } else {
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    f.src = url
    frame = f
  }
  content.append(frame as unknown as Node)

  const el = document.createElement('div')
  el.className = 'tab'
  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = url
  const close = document.createElement('button')
  close.className = 'x'
  close.textContent = '✕'
  close.title = 'close tab'
  el.append(label, close)
  tabstrip.append(el)

  const tab: Tab = { id, frame, el, label, url, title: url }
  tabs.push(tab)

  el.addEventListener('click', (e) => {
    if (e.target === close) return
    setActive(tab)
  })
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    closeTab(tab)
  })

  // Controlled Frame fires webview-style lifecycle events.
  frame.addEventListener('loadcommit', () => {
    void refreshTab(tab)
    if (tab === active) syncToolbar()
  })
  frame.addEventListener('loadstop', () => {
    void refreshTab(tab)
    if (tab === active) syncToolbar()
  })
  frame.addEventListener('load', () => void refreshTab(tab))

  if (activate) setActive(tab)
  log(`tab ${id}: ${url}`)
  return tab
}

/** Pull the guest's real URL/title back out. There's no title event we can
 *  rely on, so we ask the page — which doubles as an executeScript check. */
async function refreshTab(tab: Tab) {
  const f = tab.frame as ControlledFrame
  if (typeof f.executeScript !== 'function') {
    tab.label.textContent = tab.url
    return
  }
  try {
    const res = (await f.executeScript({
      code: 'JSON.stringify({t: document.title, u: location.href})',
    })) as unknown[]
    const raw = Array.isArray(res) ? res[0] : res
    const { t, u } = JSON.parse(String(raw)) as { t: string; u: string }
    tab.title = t || u
    tab.url = u
    tab.label.textContent = tab.title
    tab.el.title = u
  } catch {
    // Cross-origin guests can refuse; fall back to what we navigated to.
    tab.label.textContent = tab.title
  }
}

function setActive(tab: Tab) {
  active = tab
  for (const t of tabs) {
    t.el.classList.toggle('active', t === tab)
    ;(t.frame as HTMLElement).classList.toggle('active', t === tab)
  }
  syncToolbar()
}

function closeTab(tab: Tab) {
  const i = tabs.indexOf(tab)
  if (i < 0) return
  tab.el.remove()
  ;(tab.frame as unknown as ChildNode).remove()
  tabs.splice(i, 1)
  if (active === tab) {
    const next = tabs[i] ?? tabs[i - 1] ?? null
    if (next) setActive(next)
    else newTab()
  }
  log(`closed tab ${tab.id}`)
}

async function syncToolbar() {
  if (!active) return
  if (document.activeElement !== urlInput) urlInput.value = active.url
  const f = active.frame as ControlledFrame
  const can = async (fn?: () => Promise<boolean> | boolean) => {
    try {
      return typeof fn === 'function' ? await fn() : false
    } catch {
      return false
    }
  }
  backBtn.disabled = !(await can((f as unknown as { canGoBack?: () => boolean }).canGoBack?.bind(f)))
  fwdBtn.disabled = !(await can(
    (f as unknown as { canGoForward?: () => boolean }).canGoForward?.bind(f),
  ))
}

function navigate(url: string) {
  if (!active) return
  const target = normalizeUrl(url)
  active.url = target
  active.title = target
  active.label.textContent = target
  if (cf.available) (active.frame as ControlledFrame).src = target
  else (active.frame as HTMLIFrameElement).src = target
  log(`navigate → ${target}`)
}

// ------------------------------------------------------------------- wiring

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(urlInput.value)
    urlInput.blur()
  }
})
$<HTMLButtonElement>('newtab').addEventListener('click', () => newTab())
backBtn.addEventListener('click', () => (active?.frame as ControlledFrame)?.back?.())
fwdBtn.addEventListener('click', () => (active?.frame as ControlledFrame)?.forward?.())
$<HTMLButtonElement>('reload').addEventListener('click', () => {
  const f = active?.frame as ControlledFrame | undefined
  if (typeof f?.reload === 'function') f.reload()
  else if (active) navigate(active.url)
})
$<HTMLButtonElement>('logtoggle').addEventListener('click', () => {
  logEl.hidden = !logEl.hidden
})

/** The archive smoke test: read the active guest's DOM out. */
$<HTMLButtonElement>('capture').addEventListener('click', async () => {
  if (!active) return
  const f = active.frame as ControlledFrame
  if (typeof f.executeScript !== 'function') return log('executeScript unavailable', 'err')
  logEl.hidden = false
  try {
    const res = await f.executeScript({
      code: 'JSON.stringify({title: document.title, url: location.href, bytes: document.documentElement.outerHTML.length})',
    })
    log(`capture → ${JSON.stringify(res)}`, 'ok')
  } catch (e) {
    log(`capture failed: ${e instanceof Error ? e.message : String(e)}`, 'err')
  }
})

// Mod+T / Mod+W, like a browser.
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return
  if (e.key === 't') {
    e.preventDefault()
    newTab()
  } else if (e.key === 'w') {
    e.preventDefault()
    if (active) closeTab(active)
  } else if (e.key === 'l') {
    e.preventDefault()
    urlInput.focus()
    urlInput.select()
  }
})

cspSelfTest()
// flow-md is just a tab — an ordinary page, so MDX/eval work as they always
// have. The second tab proves arbitrary third-party sites load too.
newTab(HOME)
newTab('https://example.com', false)
