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
}

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
  setActive(active: boolean): void
  destroy(): void
}

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
        const res = (await f.executeScript({
          code: 'JSON.stringify({title:document.title,url:location.href,bytes:document.documentElement.outerHTML.length})',
        })) as unknown
        const raw = Array.isArray(res) ? res[0] : res
        return JSON.parse(String(raw)) as FrameInfo
      } catch {
        return null
      }
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
