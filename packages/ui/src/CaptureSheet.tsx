import { type KeyboardEvent, type MouseEvent, useEffect, useRef } from 'react'
import styles from './CaptureSheet.module.css'

export interface CaptureSource {
  title: string
  url: string
  /** Favicon as a data: URL, when the shell has one for the tab. */
  icon?: string | null
  /** Where in the page it came from — a video's timestamp, a tweet's author. */
  note?: string
}

export interface CaptureSpace {
  id: string
  name: string
  emoji?: string
}

export interface CaptureSheetProps {
  open: boolean
  /** The clip, editable. Prefilled from the selection, empty when there
   *  wasn't one — capture is also just somewhere to type a thought. */
  value: string
  onChange: (value: string) => void
  source?: CaptureSource | null
  spaces: CaptureSpace[]
  spaceId: string
  onSpaceChange: (id: string) => void
  onSave: () => void
  onDismiss: () => void
}

/** What ⌘L opens: the clip, before it's committed.
 *
 *  Capture that writes silently is faster, but it gives you nowhere to trim a
 *  selection that caught too much, add the sentence explaining why you kept
 *  it, or send it somewhere other than where you happen to be standing. So
 *  this is a pause, not a form — prefilled, focused, and dismissable with the
 *  key you'd expect, and ⌘⏎ away from being filed. */
export function CaptureSheet(props: CaptureSheetProps) {
  const { open, value, onChange, source, spaces, spaceId, onSpaceChange } = props
  const { onSave, onDismiss } = props
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    const el = field.current
    if (!el) return
    el.focus()
    // Caret at the end, not a selection: the clip is usually kept and added
    // to, and selecting it all means the first keystroke destroys it.
    el.setSelectionRange(el.value.length, el.value.length)
  }, [open])

  if (!open) return null

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onDismiss()
      return
    }
    // ⌘⏎ files it. Plain Enter has to stay a newline: the body is prose, and
    // a clip worth keeping is often more than one line.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      onSave()
    }
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(e: MouseEvent) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      <div className={styles.sheet} role="dialog" aria-label="Capture" onKeyDown={keys}>
        {source && (
          <div className={styles.source}>
            {source.icon ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- the title names it
              <img className={styles.favicon} src={source.icon} alt="" aria-hidden="true" />
            ) : (
              <span className={styles.dot} />
            )}
            <span className={styles.sourceTitle}>{source.title || source.url}</span>
            {source.note && <span className={styles.sourceNote}>{source.note}</span>}
          </div>
        )}

        <textarea
          ref={field}
          className={styles.body}
          value={value}
          rows={10}
          placeholder="Clip the selection, or just write it down…"
          aria-label="Capture"
          onChange={(e) => onChange(e.target.value)}
        />

        <div className={styles.footer}>
          <label className={styles.destination}>
            <span className={styles.into}>into</span>
            <select
              className={styles.select}
              value={spaceId}
              aria-label="Where to file it"
              onChange={(e) => onSpaceChange(e.target.value)}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji ? `${s.emoji} ${s.name}` : s.name}
                </option>
              ))}
            </select>
          </label>
          <span className={styles.hint}>
            <kbd>⌘</kbd>
            <kbd>⏎</kbd> save · <kbd>esc</kbd> discard
          </span>
          <button type="button" className={styles.save} onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
