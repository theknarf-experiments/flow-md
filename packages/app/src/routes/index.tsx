// `/` — vault overview: counts plus a pointer into the docs, so an empty
// screen never greets a fresh vault. Reads straight from the live notes
// collection (which also serves from the localStorage cache offline).

import { useLiveQuery } from '@tanstack/react-db'
import { Link, createFileRoute } from '@tanstack/react-router'
import { notesCollection } from '../lib/db.js'
import styles from './index.module.css'

export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  const { data: notes } = useLiveQuery((q) => q.from({ note: notesCollection }))
  const all = (notes ?? []).map((n) => n.path)
  const md = all.filter((f) => f.endsWith('.md'))
  return (
    <div className={styles.landing}>
      <h1>flow-md</h1>
      <p>
        A markdown vault as a live Datalog notebook. {md.length} notes
        {all.length > md.length ? ` + ${all.length - md.length} other files` : ''}{' '}
        indexed.
      </p>
      <p>
        Pick a note from the sidebar, or start with{' '}
        {md[0] ? (
          <Link to="/note/$" params={{ _splat: md[0] }}>
            {md[0]}
          </Link>
        ) : (
          <em>creating one with “+ note”</em>
        )}
        .
      </p>
      <p className="hint">
        <code>```datalog-query</code> blocks render as live tables. Cells
        backed by writable columns can be edited in place, and task
        checkboxes write straight back into the markdown.
      </p>
    </div>
  )
}
