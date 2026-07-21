import styles from './SpaceRail.module.css'

export interface SpaceRailItem {
  id: string
  name: string
  title?: string
}

export interface SpaceRailProps {
  spaces: SpaceRailItem[]
  activeId: string
  onSelect: (id: string) => void
}

/** The row of spaces along the bottom of a sidebar. Each space is a whole
 *  container in the app's terms; here it's just a segmented control. */
export function SpaceRail({ spaces, activeId, onSelect }: SpaceRailProps) {
  return (
    <div className={styles.rail}>
      {spaces.map((space) => (
        <button
          key={space.id}
          type="button"
          className={`${styles.space} ${space.id === activeId ? styles.active : ''}`}
          onClick={() => onSelect(space.id)}
          title={space.title ?? space.name}
        >
          {space.name}
        </button>
      ))}
    </div>
  )
}
