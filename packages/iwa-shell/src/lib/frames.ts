// A thin imperative wrapper around <controlledframe>.
//
// Deliberately outside React's reconciliation. Two reasons: `partition` has
// to be set *before* `src` or it silently doesn't apply, and a guest must
// never be unmounted/remounted by a re-render — that would throw away the
// page. React owns the chrome; this owns the guests.

import type { ControlledFrame, NewWindowEvent } from '../controlled-frame.js'
import { controlledFrame } from './env.js'

export interface FrameInfo {
  title: string
  url: string
  bytes: number
  /** The guest's favicon as a data: URL, or null while it's still being
   *  fetched. Not the plain href: an IWA's CSP allows `img-src … https: data:`
   *  but not `http:`, so a localhost guest's icon would be blocked. Fetching
   *  it inside the guest and inlining it sidesteps that for every scheme. */
  icon: string | null
}

// executeScript returns the completion value but does *not* resolve promises
// (an async IIFE comes back as {}), so this can't await the fetch. Instead it
// starts the fetch on first call, caches the result on the guest's window,
// and returns it on a later call.
const PROBE = `(() => {
  const w = window
  if (w.__flowmdIcon === undefined) {
    w.__flowmdIcon = null
    const link = document.querySelector('link[rel~="icon"]')
    const href = link ? link.href : location.origin + '/favicon.ico'
    fetch(href)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('no icon'))))
      .then((b) => {
        if (b.size > 200000) throw new Error('icon too large')
        const fr = new FileReader()
        fr.onload = () => { w.__flowmdIcon = String(fr.result) }
        fr.readAsDataURL(b)
      })
      .catch(() => { w.__flowmdIcon = '' })
  }
  return JSON.stringify({
    title: document.title,
    url: location.href,
    bytes: document.documentElement.outerHTML.length,
    icon: w.__flowmdIcon || null,
  })
})()`

export interface FrameHandle {
  readonly el: HTMLElement
  navigate(url: string): void
  reload(): void
  back(): void
  forward(): void
  canGoBack(): Promise<boolean>
  canGoForward(): Promise<boolean>
  /** Reads the guest's DOM — the web-archive primitive. */
  probe(): Promise<FrameInfo | null>
  /** Teaches a freshly loaded guest to hand vim keys back to the shell. */
  adopt(): Promise<void>
  /** Labels every clickable thing in view and waits for a label to be typed. */
  hint(newTab: boolean): Promise<number>
  /** Scrolls the guest by a number of px. Negative is up. */
  scrollBy(dy: number): void
  scrollToEdge(edge: 'top' | 'end'): void
  setActive(active: boolean): void
  destroy(): void
}

/** Keys a guest hands back to the shell instead of handling itself.
 *
 *  A guest is a separate process with its own focus, so once you click a page
 *  the shell stops seeing keystrokes entirely — which would make the vim
 *  bindings work only until you touched anything. This script re-posts just
 *  those keys to the embedder, which replays them as ordinary keydowns.
 *
 *  It stays out of the way where it should: a page's own text fields, and
 *  anything with a modifier the shell doesn't claim. */
const FORWARD_KEYS = `(() => {
  const w = window
  if (w.__flowmdKeys) return
  w.__flowmdKeys = true
  let shell = null
  w.addEventListener('message', (e) => {
    if (e.data === 'flowmd:hello' && e.source) shell = e.source
  })
  const claimed = (e) => {
    // Hint mode owns the keyboard while it's up, letters included.
    if (w.__flowmdHints) return false
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    if (e.shiftKey) return e.key === 'G' || e.key === 'H' || e.key === 'L' || e.key === 'F'
    return e.key === 'j' || e.key === 'k' || e.key === 'g' || e.key === 'f'
  }
  w.addEventListener(
    'keydown',
    (e) => {
      if (!shell || !claimed(e)) return
      const el = document.activeElement
      // Typing in the page is the page's business.
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      e.preventDefault()
      shell.postMessage({ flowmd: 'key', key: e.key, code: e.code, shiftKey: e.shiftKey }, '*')
    },
    true,
  )
})()`

/** Vimium's `f`: label every clickable thing in view, then type a label.
 *
 *  The whole interaction runs inside the guest. Hints have to be drawn there
 *  anyway — only the guest knows where its links are, and labels in its own
 *  DOM stay glued to the page — and putting the keystroke handling there too
 *  means there's one implementation rather than one per focus state.
 *
 *  Opening in a new tab is a meta-click, which the guest reports as a
 *  `newwindow` and the shell writes into the space as a child of this tab.
 *  Same path as ⌘-clicking by hand, so hinted tabs land in the tree too. */
const hintScript = (newTab: boolean) => `(() => {
  const w = window
  // Home-row first, and no key that a page is likely to want back.
  const KEYS = 'sadfjklewcmpgh'
  if (w.__flowmdHintsCancel) w.__flowmdHintsCancel()

  const SEL = [
    'a[href]', 'button', 'select', 'textarea', 'summary', 'label',
    'input:not([type=hidden]):not([disabled])',
    '[role=button]', '[role=link]', '[role=tab]', '[role=checkbox]',
    '[onclick]', '[contenteditable=""]', '[contenteditable=true]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')

  const vw = innerWidth, vh = innerHeight
  const targets = []
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect()
    // On screen, and big enough to mean anything.
    if (r.width < 3 || r.height < 3) continue
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue
    targets.push({ el: el, r: r })
  }
  if (!targets.length) return 0
  // Reading order, so the shortest labels sit where the eye already is.
  targets.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)

  // Uniform-length labels in base-KEYS: no label is a prefix of another, so
  // a complete label is unambiguous the moment it's typed.
  let len = 1
  while (Math.pow(KEYS.length, len) < targets.length) len++
  const label = (i) => {
    let s = ''
    for (let d = 0; d < len; d++) {
      s = KEYS[i % KEYS.length] + s
      i = Math.floor(i / KEYS.length)
    }
    return s
  }

  // A shadow root so the page's CSS can't restyle the hints or vice versa.
  const host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = '<style>' +
    // Sits astride the top-left corner rather than over the text: a hint that
    // hides the first two letters of the link it labels is a hint you can't read.
    '.h{position:fixed;transform:translate(-5px,-72%);padding:1px 4px;border-radius:5px;' +
    'font:700 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.5px;' +
    'color:#3a2a00;background:linear-gradient(#ffe27a,#f7c948);border:1px solid #c99a10;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.45);white-space:nowrap}' +
    '.h.off{display:none}.h .u{opacity:.35}</style>'
  document.documentElement.append(host)

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    t.key = label(i)
    const tag = document.createElement('div')
    tag.className = 'h'
    tag.textContent = t.key.toUpperCase()
    tag.style.left = Math.max(0, t.r.left) + 'px'
    // Enough room for the chip to sit above the corner without clipping.
    tag.style.top = Math.max(11, t.r.top) + 'px'
    root.append(tag)
    t.tag = tag
  }

  let typed = ''
  const cancel = () => {
    w.__flowmdHints = false
    w.__flowmdHintsCancel = null
    host.remove()
    removeEventListener('keydown', onKey, true)
    removeEventListener('scroll', cancel, true)
  }
  const activate = (t) => {
    const el = t.el
    cancel()
    // A field wants the caret, not a click.
    if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      el.focus()
      return
    }
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: w, metaKey: ${newTab},
    }))
  }
  const onKey = (e) => {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.key === 'Escape') return cancel()
    if (e.key === 'Backspace') typed = typed.slice(0, -1)
    else {
      const ch = e.key.toLowerCase()
      // Anything outside the alphabet means the hint was a mistake.
      if (ch.length !== 1 || KEYS.indexOf(ch) < 0) return cancel()
      typed += ch
    }
    let live = 0, only = null
    for (const t of targets) {
      const hit = t.key.indexOf(typed) === 0
      t.tag.classList.toggle('off', !hit)
      if (!hit) continue
      live++
      only = t
      // Grey out what's already been typed, so what's left to type stands out.
      t.tag.innerHTML = '<span class="u">' + t.key.slice(0, typed.length).toUpperCase() +
        '</span>' + t.key.slice(typed.length).toUpperCase()
    }
    if (!live) return cancel()
    if (live === 1 && only.key === typed) activate(only)
  }
  w.__flowmdHints = true
  w.__flowmdHintsCancel = cancel
  addEventListener('keydown', onKey, true)
  addEventListener('scroll', cancel, true)
  return targets.length
})()`

const LIFECYCLE = ['loadcommit', 'loadstop', 'loadabort', 'load'] as const

export function createFrame(
  url: string,
  partition: string,
  container: HTMLElement,
  activeClass: string,
  onLifecycle: () => void,
  /** The guest asked for a window of its own — ⌘-click, target=_blank,
   *  window.open. Given the url it wanted; the request itself is discarded. */
  onNewWindow?: (url: string) => void,
): FrameHandle {
  let el: HTMLElement
  if (controlledFrame.available) {
    const f = document.createElement('controlledframe') as ControlledFrame
    f.setAttribute('partition', partition)
    f.setAttribute('src', url)
    el = f as unknown as HTMLElement
  } else {
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    f.src = url
    el = f
  }
  container.append(el)
  for (const ev of LIFECYCLE) el.addEventListener(ev, onLifecycle)
  el.addEventListener('newwindow', (event) => {
    const e = event as NewWindowEvent
    // Nothing is attached to the request, so Chrome drops it — the url is
    // what matters and the embedder decides where it goes.
    e.preventDefault()
    e.window?.discard?.()
    if (e.targetUrl) onNewWindow?.(e.targetUrl)
  })

  const cf = () => el as unknown as ControlledFrame
  const call = async (fn?: () => unknown): Promise<boolean> => {
    try {
      return typeof fn === 'function' ? Boolean(await fn()) : false
    } catch {
      return false
    }
  }

  /** Run a snippet inside the guest, ignoring the result. Guests can be
   *  mid-navigation, in which case executeScript throws; nothing here is
   *  important enough to care. */
  const exec = async (code: string) => {
    const f = cf()
    if (typeof f.executeScript !== 'function') return
    try {
      await f.executeScript({ code })
    } catch {
      /* the guest wasn't ready */
    }
  }

  return {
    el,
    navigate(next) {
      if (controlledFrame.available) cf().src = next
      else (el as HTMLIFrameElement).src = next
    },
    reload() {
      const f = cf()
      if (typeof f.reload === 'function') f.reload()
      else (el as HTMLIFrameElement).src = (el as HTMLIFrameElement).src
    },
    back() {
      cf().back?.()
    },
    forward() {
      cf().forward?.()
    },
    canGoBack: () => call((cf() as { canGoBack?: () => boolean }).canGoBack?.bind(cf())),
    canGoForward: () =>
      call((cf() as { canGoForward?: () => boolean }).canGoForward?.bind(cf())),
    async probe() {
      const f = cf()
      if (typeof f.executeScript !== 'function') return null
      try {
        const res = (await f.executeScript({ code: PROBE })) as unknown
        const raw = Array.isArray(res) ? res[0] : res
        return JSON.parse(String(raw)) as FrameInfo
      } catch {
        return null
      }
    },
    /** Installs the key forwarder and hands the guest a way to reach us. */
    async adopt() {
      await exec(FORWARD_KEYS)
      const f = cf() as { contentWindow?: Window | null }
      f.contentWindow?.postMessage('flowmd:hello', '*')
    },
    /** The hints are the guest's, and so is the typing that follows — which
     *  only reaches them if the guest has the keyboard. Pressing `f` from the
     *  chrome therefore hands focus over on the way in. */
    async hint(newTab) {
      const f = cf()
      if (typeof f.executeScript !== 'function') return 0
      try {
        const res = (await f.executeScript({ code: hintScript(newTab) })) as unknown
        el.focus()
        return Number(Array.isArray(res) ? res[0] : res) || 0
      } catch {
        return 0
      }
    },
    /** Scrolling happens inside the guest, so it has to be scripted in.
     *  `scrollingElement` rather than `window`: a page whose scroller is a
     *  styled <div> — which most app-shaped pages are — ignores window.scrollBy. */
    scrollBy(dy) {
      void exec(`(() => {
        const el = document.scrollingElement || document.documentElement
        const inner = el.scrollHeight <= el.clientHeight
          ? [...document.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 40)
          : null
        ;(inner || el).scrollBy({ top: ${dy}, behavior: 'instant' })
      })()`)
    },
    scrollToEdge(edge) {
      void exec(`(() => {
        const el = document.scrollingElement || document.documentElement
        const inner = el.scrollHeight <= el.clientHeight
          ? [...document.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 40)
          : null
        const target = inner || el
        target.scrollTo({ top: ${edge === 'top' ? '0' : 'target.scrollHeight'}, behavior: 'instant' })
      })()`)
    },
    setActive(active) {
      el.classList.toggle(activeClass, active)
    },
    destroy() {
      for (const ev of LIFECYCLE) el.removeEventListener(ev, onLifecycle)
      el.remove()
    },
  }
}

/** Bare host, a scheme-guess, or a search. */
export function normalizeUrl(input: string, fallback: string): string {
  const s = input.trim()
  if (!s) return fallback
  if (/^https?:\/\//i.test(s)) return s
  if (/^[\w.-]+(:\d+)?(\/|$)/.test(s)) return `http://${s}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
}
