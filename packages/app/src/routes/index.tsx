// `/` — the vault's own index.md, rendered in place (the URL stays `/`,
// Obsidian-home-page-style). If the vault has no index.md, a single quiet
// hint line points at the sidebar and ⌘K — no branded landing page.

import { useLiveQuery } from '@tanstack/react-db'
import { createFileRoute } from '@tanstack/react-router'
import { NotePage } from '../components/NotePage.js'
import { notesCollection } from '../lib/db.js'
import styles from './index.module.css'

const INDEX = 'index.md'

export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  const { data: notes } = useLiveQuery((q) => q.from({ note: notesCollection }))
  const paths = (notes ?? []).map((n) => n.path)
  if (paths.includes(INDEX)) return <NotePage path={INDEX} />
  return (
    <div className={styles.landing}>
      <p className="hint">
        {paths.length === 0
          ? 'nothing here yet — ⌘K to create a note'
          : `no ${INDEX} — pick a note from the sidebar, or ⌘K`}
      </p>
    </div>
  )
}
