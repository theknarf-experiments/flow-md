// Inline source editor for one block — styled to sit in the text flow (no
// box swap), so editing feels continuous rather than modal:
//
//   • the caret lands where you clicked (the view passes the text offset)
//   • in `flow` blocks (paragraphs, headings) plain Enter commits and keeps
//     writing in a fresh block below, Notion-style; Shift+Enter inserts a
//     newline. `verbatim` blocks (lists, fences, quotes, tables) keep Enter
//     as a newline.
//   • ArrowUp on the first line / ArrowDown on the last line walk the caret
//     into the neighbouring block, like one continuous document.
//   • blur or Mod+Enter/Mod+S commits; Escape cancels.

import { useEffect, useRef, useState } from 'react'
import styles from './BlockEditor.module.css'

export type BlockKind = 'flow' | 'verbatim'

export function BlockEditor(props: {
  initial: string
  /** Caret offset to start at; -1 means "end of text". */
  caret?: number
  kind?: BlockKind
  placeholder?: string
  onCommit: (draft: string) => void
  onCancel: () => void
  /** Enter in a flow block: commit and continue in a new block below. */
  onContinue?: (draft: string) => void
  /** Arrow past the first/last line: move editing to the neighbour. */
  onNavigate?: (dir: 'up' | 'down', draft: string) => void
}) {
  const { initial, caret = -1, kind = 'flow', placeholder } = props
  const [draft, setDraft] = useState(initial)
  const done = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const at = caret < 0 ? el.value.length : Math.min(caret, el.value.length)
    el.setSelectionRange(at, at)
  }, [caret])

  // Wrap the terminal actions so exactly one fires (a commit must suppress
  // the blur that follows it, Escape must suppress the blur-commit, ...).
  const finish = (action: (draft: string) => void) => {
    if (done.current) return
    done.current = true
    action(draft)
  }

  const commit = () => finish((d) => (d === initial ? props.onCancel() : props.onCommit(d)))

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (e.key === 'Escape') {
      e.preventDefault()
      finish(() => props.onCancel())
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key === 's')) {
      e.preventDefault()
      commit()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && kind === 'flow' && props.onContinue) {
      e.preventDefault()
      finish((d) => props.onContinue!(d))
      return
    }
    if (props.onNavigate && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const at = el.selectionStart
      const onFirstLine = el.value.lastIndexOf('\n', at - 1) < 0
      const onLastLine = !el.value.includes('\n', at)
      if (e.key === 'ArrowUp' && onFirstLine) {
        e.preventDefault()
        finish((d) => props.onNavigate!('up', d))
        return
      }
      if (e.key === 'ArrowDown' && onLastLine) {
        e.preventDefault()
        finish((d) => props.onNavigate!('down', d))
        return
      }
    }
  }

  return (
    <textarea
      ref={ref}
      className={`${styles.block} ${kind === 'verbatim' ? styles.verbatim : styles.flow}`}
      data-testid="block-editor"
      spellCheck={false}
      value={draft}
      placeholder={placeholder}
      rows={Math.max(draft.split('\n').length, 1)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}
