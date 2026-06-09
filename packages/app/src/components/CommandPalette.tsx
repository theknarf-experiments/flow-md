// Cmd+K command palette: fuzzy file search, free-text content search across
// the whole vault (we have every note's content client-side in the notes
// collection, so this is just a scan), and a few app commands. Keyboard
// driven: arrows + Enter, Escape closes.

import { useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { notesCollection } from '../lib/db.js'
import { fuzzyFilter } from '../lib/fuzzy.js'
import styles from './CommandPalette.module.css'

export interface PaletteCommand {
  label: string
  run: () => void
}

interface Item {
  kind: 'command' | 'file' | 'text'
  key: string
  label: string
  detail?: string
  run: () => void
}

export function CommandPalette(props: {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
}) {
  const { open, onClose, commands } = props
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { data: notes } = useLiveQuery((q) => q.from({ note: notesCollection }))

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // Focus after the dialog renders.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const all = notes ?? []
    const goto = (path: string) => () => {
      onClose()
      void navigate({ to: '/note/$', params: { _splat: path } })
    }

    const fileItems: Item[] = fuzzyFilter(all, query, (n) => n.path).map((n) => ({
      kind: 'file',
      key: `file:${n.path}`,
      label: n.path,
      run: goto(n.path),
    }))

    const commandItems: Item[] = fuzzyFilter(commands, query, (c) => c.label, 4).map(
      (c) => ({
        kind: 'command',
        key: `cmd:${c.label}`,
        label: c.label,
        run: () => {
          onClose()
          c.run()
        },
      }),
    )

    // Free-text content search: substring, case-insensitive, one hit per
    // file, with the matching line as the detail.
    const textItems: Item[] = []
    const q = query.trim().toLowerCase()
    if (q.length >= 2) {
      for (const n of all) {
        const at = n.content.toLowerCase().indexOf(q)
        if (at < 0) continue
        const lineStart = n.content.lastIndexOf('\n', at) + 1
        const lineEnd = n.content.indexOf('\n', at)
        const line = n.content
          .slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
          .trim()
        textItems.push({
          kind: 'text',
          key: `text:${n.path}`,
          label: n.path,
          detail: line.slice(0, 80),
          run: goto(n.path),
        })
        if (textItems.length >= 8) break
      }
    }

    // Dedup: a file already shown as a name match doesn't need a text hit.
    const seen = new Set(fileItems.map((i) => i.label))
    return [
      ...commandItems,
      ...fileItems,
      ...textItems.filter((i) => !seen.has(i.label)),
    ]
  }, [notes, query, commands, navigate, onClose])

  useEffect(() => {
    setSelected(0)
  }, [items.length])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[selected]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      data-testid="command-palette"
    >
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="command palette"
      >
        <input
          ref={inputRef}
          className={styles.input}
          placeholder="Search files, content and commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className={styles.results}>
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                className={i === selected ? styles.selected : ''}
                onMouseEnter={() => setSelected(i)}
                onClick={item.run}
              >
                <span className={styles.kind}>{KIND_LABEL[item.kind]}</span>
                <span className={styles.label}>{item.label}</span>
                {item.detail && (
                  <span className={styles.detail}>{item.detail}</span>
                )}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className={styles.none}>no matches</li>}
        </ul>
      </div>
    </div>
  )
}

const KIND_LABEL: Record<Item['kind'], string> = {
  command: '⌘',
  file: '📄',
  text: '🔍',
}
