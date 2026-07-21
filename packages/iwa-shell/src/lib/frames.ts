// A thin imperative wrapper around <controlledframe>.
//
// Deliberately outside React's reconciliation. Two reasons: `partition` has
// to be set *before* `src` or it silently doesn't apply, and a guest must
// never be unmounted/remounted by a re-render — that would throw away the
// page. React owns the chrome; this owns the guests.

import type { ControlledFrame } from '../controlled-frame.js'
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
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    if (e.shiftKey) return e.key === 'G' || e.key === 'H' || e.key === 'L'
    return e.key === 'j' || e.key === 'k' || e.key === 'g'
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

const LIFECYCLE = ['loadcommit', 'loadstop', 'loadabort', 'load'] as const

export function createFrame(
  url: string,
  partition: string,
  container: HTMLElement,
  activeClass: string,
  onLifecycle: () => void,
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
