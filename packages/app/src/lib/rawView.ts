// Raw-source mode as a tiny module store: NotePage renders by it, the ⌘K
// palette toggles it. It's the escape hatch for broken MDX, .ics files, or
// wholesale rewrites — app-level, like the theme, so it needs no chrome.

import { useSyncExternalStore } from 'react'

let raw = false
const listeners = new Set<() => void>()

export function toggleRawView(): void {
  raw = !raw
  for (const l of listeners) l()
}

export function useRawView(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => raw,
    () => false,
  )
}
