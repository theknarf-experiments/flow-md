import styles from './Tab.module.css'

export interface TabProps {
  label: string
  /** Favicon, as a URL the host CSP will actually load (a data: URL is
   *  safest). Falls back to a dot when absent or broken. */
  icon?: string | null
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
export function Tab(props: TabProps) {
  const { label, icon, title, active, pinned, onSelect, onTogglePin, onClose } = props
  return (
    <button
      type="button"
      className={`${styles.tab} ${active ? styles.active : ''}`}
      onClick={onSelect}
      title={title ?? label}
    >
      {icon ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- decorative; the label names the tab
        <img className={styles.favicon} src={icon} alt="" aria-hidden="true" />
      ) : (
        <span className={styles.dot} />
      )}
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
