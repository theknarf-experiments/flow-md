// Cmd+K command palette: fuzzy file search, free-text content search across
// the whole vault (we have every note's content client-side in the notes
// collection, so this is just a scan), and a few app commands.
//
// Only the searching lives here. Rendering, keyboard nav and dismissal come
// from @flow-md/ui's CommandPalette, which the shell uses too.

import { type PaletteItem, CommandPalette as Palette } from '@flow-md/ui'
import { fileIcon } from '@flow-md/view-filetree'
import { useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { notesCollection } from '../lib/db.js'
import { fuzzyFilter } from '../lib/fuzzy.js'

export interface PaletteCommand {
  label: string
  run: () => void
}

export function CommandPalette(props: {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
}) {
  const { open, onClose, commands } = props
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const { data: notes } = useLiveQuery((q) => q.from({ note: notesCollection }))

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const all = notes ?? []
    const goto = (path: string) => () => {
      onClose()
      void navigate({ to: '/note/$', params: { _splat: path } })
    }

    // Show plenty of files — ⌘K is the primary navigation surface, and the
    // results list scrolls.
    const fileItems: PaletteItem[] = fuzzyFilter(all, query, (n) => n.path, 50).map((n) => ({
      key: `file:${n.path}`,
      icon: fileIcon(n.path),
      label: n.path,
      run: goto(n.path),
    }))

    const commandItems: PaletteItem[] = fuzzyFilter(commands, query, (c) => c.label, 4).map(
      (c) => ({
        key: `cmd:${c.label}`,
        icon: '⌘',
        label: c.label,
        run: () => {
          onClose()
          c.run()
        },
      }),
    )

    // Free-text content search: substring, case-insensitive, one hit per
    // file, with the matching line as the detail.
    const textItems: PaletteItem[] = []
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
          key: `text:${n.path}`,
          icon: fileIcon(n.path),
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

  return (
    <Palette
      open={open}
      query={query}
      items={items}
      placeholder="Search files, content and commands…"
      onQueryChange={setQuery}
      onDismiss={onClose}
    />
  )
}
