import styles from './Tab.module.css'

export interface TabProps {
  label: string
  /** Tooltip — usually the full URL, since the label is truncated. */
  title?: string
  active?: boolean
  pinned?: boolean
  onSelect?: () => void
  onTogglePin?: () => void
  onClose?: () => void
}

/** One row in a vertical tab list. The row itself is the button; the pin and
 *  close affordances are nested clickable spans rather than buttons, because
 *  a <button> inside a <button> is invalid HTML and React will warn. */
export function Tab({ label, title, active, pinned, onSelect, onTogglePin, onClose }: TabProps) {
  return (
    <button
      type="button"
      className={`${styles.tab} ${active ? styles.active : ''}`}
      onClick={onSelect}
      title={title ?? label}
    >
      <span className={styles.dot} />
      <span className={styles.label}>{label}</span>
      {onTogglePin && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={pinned ? 'unpin tab' : 'pin tab'}
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation()
            onTogglePin()
          }}
        >
          {pinned ? '▼' : '▲'}
        </span>
      )}
      {onClose && (
        <span
          role="button"
          tabIndex={-1}
          aria-label="close tab"
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          ✕
        </span>
      )}
    </button>
  )
}
