// Root route: the whole HTML document (Start hydrates `document` directly in
// SPA mode) plus the persistent two-pane layout — file-tree sidebar on the
// left, the active note on the right.

import { useLiveQuery } from '@tanstack/react-db'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'
import { FileTree } from '../components/FileTree.js'
import { api } from '../lib/api.js'
import { newNote, notesCollection } from '../lib/db.js'
import { usePoll } from '../lib/usePoll.js'
import '../index.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'flow-md' },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  // See example-web: flipping this via React state would re-render
  // <html>/<body> during hydration and blow the stack.
  useEffect(() => {
    document.body.setAttribute('data-hydrated', 'true')
  }, [])
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ClientOnly>
          <Shell />
        </ClientOnly>
        <Scripts />
      </body>
    </html>
  )
}

/** useLiveQuery has no server snapshot, so everything that reads the
 *  collections must wait for the client mount. The prerendered SPA shell is
 *  just the empty document — which is all it ever was. */
function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <>{children}</> : null
}

function Shell() {
  // The sidebar renders straight from the notes collection — synced (and
  // localStorage-cached, so it also renders offline) by the db layer.
  const { data: notes } = useLiveQuery((q) => q.from({ note: notesCollection }))
  const health = usePoll(() => api.health(), [], 5000)
  const navigate = useNavigate()

  const addNote = async () => {
    const name = window.prompt('New note path (e.g. notes/idea.md):')
    if (!name) return
    const path = name.endsWith('.md') ? name : `${name}.md`
    // Optimistic: the tree shows the note immediately; navigate right away.
    void newNote(path)
    void navigate({ to: '/note/$', params: { _splat: path } })
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">flow-md</span>
          <button type="button" className="ghost" onClick={() => void addNote()}>
            + note
          </button>
        </div>
        {health.error && (
          <p className="offline">
            server unreachable at <code>{api.base}</code> — showing cached vault
          </p>
        )}
        {health.data?.error && <p className="offline">{health.data.error}</p>}
        <FileTree files={(notes ?? []).map((n) => n.path)} />
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
