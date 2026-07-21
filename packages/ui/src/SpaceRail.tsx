import type { CSSProperties } from 'react'
import styles from './SpaceRail.module.css'
import { Tooltip } from './Tooltip.js'

export interface SpaceRailItem {
  id: string
  name: string
  /** Shown instead of the dot. Optional — a space without one is just a dot,
   *  which is what Arc does. */
  emoji?: string
  title?: string
}

export interface SpaceRailProps {
  spaces: SpaceRailItem[]
  activeId: string
  onSelect: (id: string) => void
  /** Adds a trailing + at the right end. Omit it and the rail is read-only. */
  onAddSpace?: () => void
}

/** The space switcher along the bottom of a sidebar: a centered row of dots,
 *  each showing its emoji if it has one. Deliberately not labelled — the
 *  current space is named in the header above, so repeating every name here
 *  would just crowd the rail as spaces are added.
 *
 *  The indicator normally sits on the active space, but it will follow an
 *  inherited `--space-position` if something upstream sets one — a fractional
 *  index, so a swipe that's halfway between two spaces shows an indicator
 *  halfway between their dots. See SwipeDeck's `onProgress`. */
export function SpaceRail({ spaces, activeId, onSelect, onAddSpace }: SpaceRailProps) {
  const activeIndex = Math.max(
    0,
    spaces.findIndex((s) => s.id === activeId),
  )
  return (
    <div
      className={styles.rail}
      // Live position if there is one, the settled space if not. Expressed as
      // a fallback rather than a ref so nothing has to re-render per frame.
      style={{ '--rail-position': `var(--space-position, ${activeIndex})` } as CSSProperties}
    >
      {/* Grouped, so the dots can be centred in the rail independently of
          whatever sits beside them. */}
      <div className={styles.dots}>
        <span className={styles.thumb} aria-hidden="true" />
        {spaces.map((space, i) => {
          const active = space.id === activeId
          return (
            // Opens upward: the rail sits at the bottom of a sidebar, so a
            // label below it would be clipped by the window.
            <Tooltip key={space.id} label={space.title ?? space.name} placement="top">
              <button
                type="button"
                className={styles.space}
                style={{ '--index': i } as CSSProperties}
                onClick={() => onSelect(space.id)}
                aria-label={space.name}
                aria-current={active ? 'true' : undefined}
              >
                {space.emoji ? (
                  <span className={styles.emoji} aria-hidden="true">
                    {space.emoji}
                  </span>
                ) : (
                  <span className={styles.dot} aria-hidden="true" />
                )}
              </button>
            </Tooltip>
          )
        })}
      </div>
      {onAddSpace && (
        <Tooltip label="New space" placement="top">
          <button
            type="button"
            className={`${styles.space} ${styles.add}`}
            onClick={onAddSpace}
            aria-label="New space"
          >
            +
          </button>
        </Tooltip>
      )}
    </div>
  )
}
