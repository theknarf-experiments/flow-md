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
}

/** The space switcher along the bottom of a sidebar: a centered row of dots,
 *  each showing its emoji if it has one. Deliberately not labelled — the
 *  current space is named in the header above, so repeating every name here
 *  would just crowd the rail as spaces are added. */
export function SpaceRail({ spaces, activeId, onSelect }: SpaceRailProps) {
  return (
    <div className={styles.rail}>
      {spaces.map((space) => {
        const active = space.id === activeId
        return (
          // Opens upward: the rail sits at the bottom of a sidebar, so a
          // label below it would be clipped by the window.
          <Tooltip key={space.id} label={space.title ?? space.name} placement="top">
            <button
              type="button"
              className={`${styles.space} ${active ? styles.active : ''}`}
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
  )
}
