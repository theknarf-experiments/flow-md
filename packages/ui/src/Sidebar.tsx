import type { ButtonHTMLAttributes, CSSProperties, MouseEvent, ReactNode, Ref } from 'react'
import { useEffect, useRef } from 'react'
import styles from './Sidebar.module.css'

export interface SidebarProps {
  children: ReactNode
  /** Collapses to zero width (animated) rather than unmounting, so the
   *  contents keep their state. */
  open?: boolean
  width?: number
  className?: string
  /** For attaching gestures — see useHorizontalSwipe. */
  ref?: Ref<HTMLElement>
}

/** Fixed-width column for chrome, with two app-window affordances that are
 *  simply no-ops in a normal browser tab: the whole surface is a window drag
 *  region, and the top padding grows by `env(titlebar-area-height)` when a
 *  window-controls overlay is active. */
export function Sidebar({ children, open = true, width = 244, className, ref }: SidebarProps) {
  return (
    <aside
      ref={ref}
      className={[styles.sidebar, open ? '' : styles.collapsed, className]
        .filter(Boolean)
        .join(' ')}
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
    >
      {children}
    </aside>
  )
}

/** Small uppercase caption above a group. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className={styles.sectionLabel}>{children}</div>
}

export interface SpaceHeaderProps {
  emoji?: string
  children: string
  /** Right-clicking the header is how Arc exposes rename/recolour/delete.
   *  Passing a handler also gives the header its hover affordance — without
   *  one it's just a caption and shouldn't pretend otherwise. */
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void
  /** Swaps the name for an input. Commit with Enter or by clicking away,
   *  abandon with Escape. */
  editing?: boolean
  onRename?: (name: string) => void
  onCancelRename?: () => void
}

/** A space's name, with its emoji — the friendlier heading Arc uses in place
 *  of a tiny uppercase caption. */
export function SpaceHeader(props: SpaceHeaderProps) {
  const { emoji, children, onContextMenu, editing, onRename, onCancelRename } = props
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    // Selected, not just focused: renaming almost always means replacing.
    input.current?.select()
  }, [editing])

  if (editing) {
    return (
      <div className={styles.spaceHeader}>
        {emoji && <span aria-hidden="true">{emoji}</span>}
        <input
          ref={input}
          className={styles.rename}
          defaultValue={children}
          aria-label="Space name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename?.(e.currentTarget.value.trim() || children)
            if (e.key === 'Escape') {
              e.stopPropagation()
              onCancelRename?.()
            }
          }}
          onBlur={(e) => onRename?.(e.currentTarget.value.trim() || children)}
        />
      </div>
    )
  }

  return (
    <div
      className={`${styles.spaceHeader} ${onContextMenu ? styles.interactive : ''}`}
      onContextMenu={onContextMenu}
    >
      {emoji && <span aria-hidden="true">{emoji}</span>}
      <span>{children}</span>
    </div>
  )
}

/** Pushes what follows to the far end of a flex row/column. */
export function Spacer() {
  return <span className={styles.spacer} />
}

/** A row of icon controls. Opts out of the window drag region so the buttons
 *  stay clickable inside a draggable Sidebar.
 *
 *  `leadingInset` reserves space at the start of the row for window controls
 *  the OS draws over the content. In a frameless window the traffic lights
 *  sit at the top-left and cannot be moved, hidden, or even located —
 *  `navigator.windowControlsOverlay` reports nothing and `env(titlebar-area-*)`
 *  is unset outside a window-controls overlay — so the row is laid out
 *  beside them instead. */
export function Toolbar({
  children,
  leadingInset = 0,
}: { children: ReactNode; leadingInset?: number }) {
  return (
    <div
      className={styles.toolbar}
      style={{ paddingLeft: leadingInset ? `${leadingInset}px` : undefined }}
    >
      {children}
    </div>
  )
}

/** Full-width ghost button for sidebar rows — "+ New tab" and friends. */
export function SidebarButton({
  children,
  className,
  type,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type ?? 'button'}
      className={[styles.sidebarButton, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
