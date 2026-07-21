import { type ReactNode, useEffect, useRef } from 'react'
import styles from './SwipeDeck.module.css'

export interface SwipeDeckProps {
  /** Which panel is shown. Changing it scrolls there smoothly. */
  index: number
  /** Fired when a gesture settles on a different panel. */
  onIndexChange?: (index: number) => void
  /** One node per panel, in the same order as the deck's items. */
  children: ReactNode
  className?: string
}

/** Panels laid out side by side like slides, showing one at a time, swiped
 *  between with the trackpad.
 *
 *  This is a real scroll container with CSS scroll snapping rather than a
 *  transform driven by `wheel` events, and that's the whole point: the
 *  browser gets the trackpad's gesture phase from the OS, so it knows when
 *  your fingers are still down. You can sit halfway between two panels
 *  indefinitely and nothing commits until you let go — which a `wheel`
 *  listener can't do, since it only sees a stream of deltas and has to guess
 *  at "released" with a timer.
 *
 *  It also gets the rest for free: release past halfway and it advances,
 *  release short of it and it springs back, rubber-band resistance at the
 *  ends with no wrapping, and horizontal gestures over a vertically
 *  scrollable panel chaining out to here without hijacking the vertical
 *  scroll. */
export function SwipeDeck({ index, onIndexChange, children, className }: SwipeDeckProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const panels = Array.isArray(children) ? children : [children]

  // Follow the index when it's changed from outside — clicking the space
  // rail, say — but never fight a scroll that's already there.
  useEffect(() => {
    const el = viewport.current
    if (!el || el.clientWidth === 0) return
    const target = index * el.clientWidth
    if (Math.abs(el.scrollLeft - target) < 1) return
    el.scrollTo({ left: target, behavior: 'smooth' })
  }, [index])

  useEffect(() => {
    const el = viewport.current
    if (!el || !onIndexChange) return
    const onScrollEnd = () => {
      if (el.clientWidth === 0) return
      const settled = Math.round(el.scrollLeft / el.clientWidth)
      if (settled !== index) onIndexChange(settled)
    }
    // scrollend fires once the gesture and any snap animation are done —
    // exactly the moment the panel is committed.
    el.addEventListener('scrollend', onScrollEnd)
    return () => el.removeEventListener('scrollend', onScrollEnd)
  }, [index, onIndexChange])

  return (
    <div
      ref={viewport}
      className={[styles.viewport, className].filter(Boolean).join(' ')}
      // The panels are chrome, not a document region to tab through.
      tabIndex={-1}
    >
      <div className={styles.track}>
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
