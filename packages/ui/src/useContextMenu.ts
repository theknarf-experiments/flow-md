import { type MouseEvent, useCallback, useState } from 'react'

export interface ContextMenuAnchor {
  x: number
  y: number
}

/** Right-click plumbing: where the menu is, and how to open and close it.
 *  Separate from <ContextMenu> so the trigger doesn't have to own the menu's
 *  markup, and so several triggers can share one menu. */
export function useContextMenu<T = void>() {
  const [anchor, setAnchor] = useState<(ContextMenuAnchor & { target: T }) | null>(null)
  const close = useCallback(() => setAnchor(null), [])
  const open = useCallback(
    (e: MouseEvent, target: T) => {
      // Suppress the browser's own menu — inside an app shell it offers
      // nothing but "reload".
      e.preventDefault()
      setAnchor({ x: e.clientX, y: e.clientY, target })
    },
    [],
  )
  return { anchor, open, close }
}
