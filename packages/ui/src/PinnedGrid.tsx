import type { MouseEvent } from 'react'
import styles from './PinnedGrid.module.css'
import { Tooltip } from './Tooltip.js'

export interface PinnedItem {
  id: string | number
  label: string
  /** Favicon as a URL the host CSP will load; falls back to the first letter
   *  of the label, which is what most sites' icons amount to anyway. */
  icon?: string | null
  title?: string
}

export interface PinnedGridProps {
  items: PinnedItem[]
  activeId?: string | number | null
  columns?: number
  onSelect: (id: string | number) => void
  onUnpin?: (id: string | number) => void
  /** Right-click affordance. A pinned tab has left the tab list, so without
   *  this its menu — unpin included — has nowhere to be opened from. */
  onContextMenu?: (e: MouseEvent<HTMLElement>, id: string | number) => void
}

/** Pinned tabs as a grid of tiles rather than rows — the shape Arc uses, and
 *  the reason a pinned set stays glanceable as it grows. */
export function PinnedGrid(props: PinnedGridProps) {
  const { items, activeId, columns = 4, onSelect, onUnpin, onContextMenu } = props
  if (items.length === 0) return null
  return (
    <div
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        // A tile has no visible text, so the label is the only way to tell
        // one pin from another.
        <Tooltip key={item.id} label={item.title ?? item.label}>
        <button
          type="button"
          className={`${styles.tile} ${item.id === activeId ? styles.active : ''}`}
          aria-label={item.label}
          onClick={() => onSelect(item.id)}
          onAuxClick={(e) => {
            // Middle-click unpins, the way middle-click closes a tab.
            if (e.button === 1) onUnpin?.(item.id)
          }}
          onContextMenu={(e) => onContextMenu?.(e, item.id)}
        >
          {item.icon ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- title carries the name
            <img className={styles.icon} src={item.icon} alt="" aria-hidden="true" />
          ) : (
            <span className={styles.letter}>{item.label.slice(0, 1).toUpperCase()}</span>
          )}
        </button>
        </Tooltip>
      ))}
    </div>
  )
}
