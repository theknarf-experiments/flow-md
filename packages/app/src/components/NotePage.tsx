// The active note, read live from the TanStack DB collections: content from
// `notes`, dataview results from `queries`, both filtered down to this path.
// No fetch orchestration here — the db layer syncs, mutations are optimistic,
// and this component just renders whatever the live queries currently hold.

import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useState } from 'react'
import { notesCollection, queriesCollection } from '../lib/db.js'
import { Editor } from './Editor.js'
import { MarkdownView } from './MarkdownView.js'

export function NotePage({ path }: { path: string }) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')

  const { data: notes } = useLiveQuery(
    (q) =>
      q.from({ note: notesCollection }).where(({ note }) => eq(note.path, path)),
    [path],
  )
  const note = notes?.[0]
  const { data: queries } = useLiveQuery(
    (q) =>
      q.from({ qr: queriesCollection }).where(({ qr }) => eq(qr.path, path)),
    [path],
  )
  const { data: allNotes } = useLiveQuery((q) =>
    q.from({ note: notesCollection }),
  )

  if (!note) {
    return (
      <div className="note">
        <p className="hint">
          nothing at <code>{path}</code> (yet — still syncing, or the file is
          gone)
        </p>
      </div>
    )
  }

  const isMarkdown = path.endsWith('.md')
  return (
    <div className="note">
      <header className="note-head">
        <h2 className="note-path">{path}</h2>
        {isMarkdown && (
          <div className="mode-switch">
            <button
              type="button"
              className={mode === 'view' ? 'active' : ''}
              onClick={() => setMode('view')}
            >
              view
            </button>
            <button
              type="button"
              className={mode === 'edit' ? 'active' : ''}
              onClick={() => setMode('edit')}
            >
              edit
            </button>
          </div>
        )}
      </header>
      {!isMarkdown ? (
        <pre className="raw">{note.content}</pre>
      ) : mode === 'edit' ? (
        <Editor key={path} path={path} initial={note.content} />
      ) : (
        <MarkdownView
          path={path}
          content={note.content}
          queries={queries ?? []}
          files={(allNotes ?? []).map((n) => n.path)}
        />
      )}
    </div>
  )
}
