import { type CSSProperties, type MouseEvent, useEffect, useRef } from 'react'
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
  /** Drag props from useReorder — spread onto the row. */
  drag?: Record<string, unknown>
  /** How deep in the tree, when the list is one. */
  depth?: number
  /** Making noise right now. The speaker only appears for tabs that are —
   *  a mute button on a silent tab is a button for nothing. */
  audible?: boolean
  muted?: boolean
  onToggleMute?: () => void
  /** Right-click affordance — the shell hangs rename/copy/move/close off it. */
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void
  /** Swaps the label for an input. Commit with Enter or by clicking away,
   *  abandon with Escape. */
  editing?: boolean
  onRename?: (label: string) => void
  onCancelRename?: () => void
}

/** One row in a vertical tab list. The row itself is the button; the pin and
 *  close affordances are nested clickable spans rather than buttons, because
 *  a <button> inside a <button> is invalid HTML and React will warn. */
export function Tab(props: TabProps) {
  const { label, icon, title, active, pinned, onSelect, onTogglePin, onClose } = props
  const { onContextMenu, editing, onRename, onCancelRename, drag, depth } = props
  const { audible, muted, onToggleMute } = props
  const indent = depth ? ({ '--depth': depth } as CSSProperties) : undefined
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    // Selected, not just focused: renaming almost always means replacing.
    input.current?.select()
  }, [editing])

  const glyph = icon ? (
    // eslint-disable-next-line jsx-a11y/alt-text -- decorative; the label names the tab
    <img className={styles.favicon} src={icon} alt="" aria-hidden="true" />
  ) : (
    <span className={styles.dot} />
  )

  if (editing) {
    // A div, not the button: an <input> inside a <button> can't be typed in.
    return (
      <div className={`${styles.tab} ${active ? styles.active : ''}`}>
        {glyph}
        <input
          ref={input}
          className={styles.rename}
          defaultValue={label}
          aria-label="Tab name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename?.(e.currentTarget.value.trim() || label)
            if (e.key === 'Escape') {
              e.stopPropagation()
              onCancelRename?.()
            }
          }}
          onBlur={(e) => onRename?.(e.currentTarget.value.trim() || label)}
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`${styles.tab} ${active ? styles.active : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={title ?? label}
      style={indent}
      {...drag}
    >
      {glyph}
      <span className={styles.label}>{label}</span>
      {onToggleMute && (audible || muted) && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={muted ? 'unmute tab' : 'mute tab'}
          className={`${styles.action} ${styles.speaker}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleMute()
          }}
        >
          {muted ? '🔇' : '🔊'}
        </span>
      )}
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
