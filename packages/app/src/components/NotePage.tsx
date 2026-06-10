// The active note, read live from the TanStack DB collections: content from
// `notes`, dataview results from `queries`, both filtered down to this path.
// No fetch orchestration here — the db layer syncs, mutations are optimistic,
// and this component just renders whatever the live queries currently hold.
//
// There is no separate edit mode: the rendered view *is* the editor (blocks
// edit in place, dataview cells and checkboxes write through). The single
// `</>` toggle opens raw source as an escape hatch — for fixing broken MDX,
// editing .ics files, or wholesale rewrites.

import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useState } from 'react'
import type { QueryResult } from '../lib/api.js'
import { notesCollection, queriesCollection } from '../lib/db.js'
import { CsvView } from './CsvView.js'
import { Editor } from './Editor.js'
import { IcsView } from './IcsView.js'
import { MdxView } from './MdxView.js'
import { LiveEditor } from './editor/LiveEditor.js'
import styles from './NotePage.module.css'

export function NotePage({ path }: { path: string }) {
  const [showSource, setShowSource] = useState(false)

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
      <div className={styles.note}>
        <p className="hint">
          nothing at <code>{path}</code> (yet — still syncing, or the file is
          gone)
        </p>
      </div>
    )
  }

  return (
    <div className={styles.note}>
      <header className={styles.head}>
        <h2 className={styles.path}>{path}</h2>
        <button
          type="button"
          className={`${styles.sourceToggle} ${showSource ? styles.active : ''}`}
          title={showSource ? 'back to the note' : 'edit raw source'}
          data-testid="source-toggle"
          onClick={() => setShowSource(!showSource)}
        >
          {'</>'}
        </button>
      </header>
      {showSource ? (
        <Editor key={path} path={path} initial={note.content} />
      ) : (
        <FileView
          path={path}
          content={note.content}
          queries={queries ?? []}
          files={(allNotes ?? []).map((n) => n.path)}
        />
      )}
    </div>
  )
}

/** Pick the view for a file by extension; raw text is the fallback. */
function FileView(props: {
  path: string
  content: string
  queries: QueryResult[]
  files: string[]
}) {
  const { path, content, queries, files } = props
  if (path.endsWith('.md')) {
    // The CM6 live editor IS the markdown view: source-of-truth document
    // with Typora-style reveal-at-caret rendering. queries/files reach the
    // editor's widgets through the live collections, not props.
    void queries
    void files
    return <LiveEditor key={path} path={path} content={content} />
  }
  if (path.endsWith('.mdx')) {
    return <MdxView path={path} content={content} queries={queries} files={files} />
  }
  if (path.endsWith('.ics')) return <IcsView content={content} />
  if (path.endsWith('.csv')) return <CsvView path={path} content={content} />
  return <pre className={styles.raw}>{content}</pre>
}
