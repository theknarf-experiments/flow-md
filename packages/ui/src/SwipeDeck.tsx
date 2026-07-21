import type { ReactNode } from 'react'
import styles from './SwipeDeck.module.css'

export interface SwipeDeckProps {
  /** Which panel is shown. */
  index: number
  /** Live drag displacement from useSwipeDeck, in px. */
  offset?: number
  dragging?: boolean
  /** One node per panel, in the same order as the deck's items. */
  children: ReactNode
  className?: string
}

/** Panels laid out side by side like slides, showing one at a time. Pair with
 *  useSwipeDeck for the gesture; on its own it just animates between indices,
 *  which is what a click on the space rail should do too. */
export function SwipeDeck({ index, offset = 0, dragging = false, children, className }: SwipeDeckProps) {
  const panels = Array.isArray(children) ? children : [children]
  return (
    <div className={[styles.viewport, className].filter(Boolean).join(' ')}>
      <div
        className={`${styles.track} ${dragging ? styles.dragging : ''}`}
        style={{ transform: `translateX(calc(${-index * 100}% + ${offset}px))` }}
      >
        {panels.map((panel, i) => (
          // Panels are positional — index is the identity here.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional by definition
          <div className={styles.panel} key={i} aria-hidden={i !== index || undefined}>
            {panel}
          </div>
        ))}
      </div>
    </div>
  )
}
