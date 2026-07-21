import { useState } from 'react'
import styles from './EmojiPicker.module.css'

export interface EmojiPickerProps {
  /** The quick choices. */
  choices: string[]
  value?: string
  onSelect: (emoji: string) => void
}

/** A grid of emoji plus a box to type any other one. No emoji database and no
 *  search: the point is to mark a space at a glance, and a dozen options plus
 *  the system picker (⌃⌘Space in the field) covers that without shipping a
 *  megabyte of names. */
export function EmojiPicker({ choices, value, onSelect }: EmojiPickerProps) {
  const [custom, setCustom] = useState('')
  return (
    <div className={styles.picker}>
      <div className={styles.grid}>
        {choices.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className={`${styles.choice} ${emoji === value ? styles.active : ''}`}
            aria-label={emoji}
            aria-pressed={emoji === value}
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <input
        className={styles.custom}
        value={custom}
        placeholder="or type one…"
        aria-label="Custom emoji"
        onChange={(e) => {
          // Keep the last character typed: emoji are multi-code-unit, and
          // spreading the string splits by code point rather than by unit.
          const typed = [...e.target.value].slice(-1).join('')
          setCustom(typed)
          if (typed) onSelect(typed)
        }}
      />
    </div>
  )
}
