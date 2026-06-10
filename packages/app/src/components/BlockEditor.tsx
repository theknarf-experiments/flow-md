// Inline source editor for one block of a note: a monospace textarea sized
// to its content, seeded with the block's source lines. Commit on blur or
// Mod+Enter / Mod+S; Escape cancels (and suppresses the blur-commit).

import { useRef, useState } from 'react'
import styles from './BlockEditor.module.css'

export function BlockEditor(props: {
  initial: string
  placeholder?: string
  onCommit: (draft: string) => void
  onCancel: () => void
}) {
  const { initial, placeholder, onCommit, onCancel } = props
  const [draft, setDraft] = useState(initial)
  const cancelled = useRef(false)

  const commit = () => {
    if (cancelled.current) return
    cancelled.current = true // a commit also suppresses the following blur
    if (draft === initial) onCancel()
    else onCommit(draft)
  }

  return (
    <textarea
      className={styles.block}
      data-testid="block-editor"
      autoFocus
      spellCheck={false}
      value={draft}
      placeholder={placeholder}
      rows={Math.max(draft.split('\n').length + 1, 2)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelled.current = true
          onCancel()
        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key === 's')) {
          e.preventDefault()
          commit()
        }
      }}
    />
  )
}
