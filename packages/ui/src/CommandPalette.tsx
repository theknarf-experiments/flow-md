// One palette for both shapes we need:
//
//   • a searchable list (the app's ⌘K: files, content, commands)
//   • a bare input (the shell's address bar — no items, Enter submits text)
//
// They only ever differed in whether results were passed, so they're the same
// component. Everything app-specific — what to search, how to rank — stays
// with the caller; this owns the interaction: keyboard nav, dismissal, and
// the two scrolling quirks documented below.

import { type ReactNode, useEffect, useRef, useState } from 'react'
import styles from './CommandPalette.module.css'

export interface PaletteItem {
  key: string
  /** Usually an emoji or glyph; kept as a node so callers can pass anything. */
  icon?: ReactNode
  label: string
  /** Secondary text, e.g. the matching line of a content search. */
  detail?: string
  run: () => void
}

export interface CommandPaletteProps {
  open: boolean
  query: string
  onQueryChange: (query: string) => void
  onDismiss: () => void
  items?: PaletteItem[]
  /** Enter when there's nothing to select — free-text entry, which is how
   *  the shell's address bar behaves. */
  onSubmit?: (value: string) => void
  placeholder?: string
  /** Line under the field. Shown when there are no items to list. */
  hint?: ReactNode
  emptyLabel?: string
  'data-testid'?: string
}

export function CommandPalette(props: CommandPaletteProps) {
  const {
    open,
    query,
    onQueryChange,
    onDismiss,
    items,
    onSubmit,
    placeholder,
    hint,
    emptyLabel = 'no matches',
    'data-testid': testId = 'command-palette',
  } = props

  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLUListElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const searchable = items !== undefined
  const rows = items ?? []

  useEffect(() => {
    if (open) {
      setSelected(0)
      // Focus once the dialog is actually in the tree.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [rows.length])

  // Keep the keyboard-selected row visible as it moves past the fold.
  useEffect(() => {
    resultsRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // The scrollable region is the (narrow, centered) results list, but the
  // pointer usually rests over the input or the dimmed backdrop — where a
  // wheel would otherwise scroll the page *behind* the palette. React's
  // onWheel is registered passively, so preventDefault there is a no-op;
  // attach a non-passive listener, route the delta to the list, and cancel
  // the default so nothing behind moves.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!open || !overlay) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const list = resultsRef.current
      if (list) list.scrollTop += e.deltaY
    }
    overlay.addEventListener('wheel', onWheel, { passive: false })
    return () => overlay.removeEventListener('wheel', onWheel)
  }, [open])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rows.length > 0) rows[selected]?.run()
      else onSubmit?.(query)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    }
  }

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      onClick={onDismiss}
      role="presentation"
      data-testid={testId}
    >
      {/* Clicks inside the panel must not reach the dismissing backdrop. */}
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="command palette"
      >
        <input
          ref={inputRef}
          className={styles.input}
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {searchable ? (
          <ul className={styles.results} ref={resultsRef}>
            {rows.map((item, i) => (
              <li key={item.key}>
                <button
                  type="button"
                  className={i === selected ? styles.selected : ''}
                  onMouseEnter={() => setSelected(i)}
                  onClick={item.run}
                >
                  {item.icon !== undefined && <span className={styles.icon}>{item.icon}</span>}
                  <span className={styles.label}>{item.label}</span>
                  {item.detail && <span className={styles.detail}>{item.detail}</span>}
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className={styles.none}>{emptyLabel}</li>}
          </ul>
        ) : (
          hint && <div className={styles.hint}>{hint}</div>
        )}
      </div>
    </div>
  )
}
