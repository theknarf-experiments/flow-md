import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './ContextMenu.module.css'

export interface ContextMenuProps {
  /** Where the pointer was, in client coordinates. */
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}

/** A menu anchored at the pointer. Closes on Escape, on a click outside, and
 *  on a scroll gesture or resize — anything that moves the thing it was
 *  opened on would leave it pointing at nothing.
 *
 *  It flips rather than clips: opened near the right or bottom edge it lays
 *  itself out the other way, measured after mount because the size depends on
 *  the items. */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menu.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    setAt({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose()
    }
    // A scroll *gesture*, not a scroll event: scroll fires for programmatic
    // adjustments too — a snap container behind the menu re-settling was
    // enough to dismiss it mid-click.
    const onWheel = (e: WheelEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose()
    }
    // Capture, so a menu closes before the click underneath it lands.
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('wheel', onWheel, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div ref={menu} className={styles.menu} style={at} role="menu">
      {children}
    </div>
  )
}

export interface ContextMenuItemProps {
  children: ReactNode
  onSelect: () => void
  /** Destructive actions read red and sit last. */
  danger?: boolean
  disabled?: boolean
}

export function ContextMenuItem({ children, onSelect, danger, disabled }: ContextMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.item} ${danger ? styles.danger : ''}`}
      disabled={disabled}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}

export function ContextMenuSeparator() {
  return <div className={styles.separator} role="separator" />
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return <div className={styles.label}>{children}</div>
}
