import type { CSSProperties, ReactNode } from 'react'
import styles from './Sidebar.module.css'

export interface SidebarProps {
  children: ReactNode
  /** Collapses to zero width (animated) rather than unmounting, so the
   *  contents keep their state. */
  open?: boolean
  width?: number
  className?: string
}

/** Fixed-width column for chrome, with two app-window affordances that are
 *  simply no-ops in a normal browser tab: the whole surface is a window drag
 *  region, and the top padding grows by `env(titlebar-area-height)` when a
 *  window-controls overlay is active. */
export function Sidebar({ children, open = true, width = 244, className }: SidebarProps) {
  return (
    <aside
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

/** Pushes what follows to the far end of a flex row/column. */
export function Spacer() {
  return <span className={styles.spacer} />
}
