import styles from './Kbd.module.css'

export interface KbdProps {
  /** One key per chip: ['⌘', 'T']. Pre-formatted — this doesn't know about
   *  platforms, and the thing that registered the binding does. */
  keys: string[]
  /** Renders the chips as a sequence: g then g, rather than g with g. */
  sequence?: boolean
}

/** Keyboard keys as chips. */
export function Kbd({ keys, sequence }: KbdProps) {
  return (
    <span className={styles.row}>
      {keys.map((key, i) => (
        <span key={`${key}-${i}`} className={styles.group}>
          {/* A sequence is pressed one after another, so it reads with a
              "then" between the chips rather than nothing. */}
          {sequence && i > 0 && <span className={styles.then}>then</span>}
          <kbd className={styles.key}>{key}</kbd>
        </span>
      ))}
    </span>
  )
}
