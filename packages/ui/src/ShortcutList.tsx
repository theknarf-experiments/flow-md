import { Kbd } from './Kbd.js'
import styles from './ShortcutList.module.css'

export interface Shortcut {
  /** What it does, in the imperative: "Close tab". */
  name: string
  /** Pre-formatted keys, one per chip. */
  keys: string[]
  /** True when the keys are pressed one after another, like g g. */
  sequence?: boolean
  /** Groups the row under a heading. Ungrouped rows come first. */
  category?: string
  hint?: string
}

export interface ShortcutListProps {
  shortcuts: Shortcut[]
}

/** A cheatsheet. Deliberately dumb: it takes rows and renders them, so the
 *  page showing it can build them from whatever is actually registered rather
 *  than from a hand-written table that drifts out of date. */
export function ShortcutList({ shortcuts }: ShortcutListProps) {
  const categories = [...new Set(shortcuts.map((s) => s.category ?? ''))]
  return (
    <div>
      {categories.map((category) => (
        <div key={category} className={styles.group}>
          {category && <div className={styles.groupTitle}>{category}</div>}
          {shortcuts
            .filter((s) => (s.category ?? '') === category)
            .map((s) => (
              <div key={s.name + s.keys.join()} className={styles.row}>
                <span className={styles.name}>
                  {s.name}
                  {s.hint && <span className={styles.hint}>{s.hint}</span>}
                </span>
                <Kbd keys={s.keys} sequence={s.sequence} />
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}
