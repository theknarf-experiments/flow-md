// Root route: the whole HTML document (Start hydrates `document` directly in
// SPA mode) plus the persistent two-pane layout — file-tree sidebar on the
// left (toggleable, Mod+B), the active note on the right, and the Mod+K
// command palette floating above everything.

import { useLiveQuery } from '@tanstack/react-db'
import { useHotkey } from '@tanstack/react-hotkeys'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'
import { CommandPalette } from '../components/CommandPalette.js'
import { FileTree } from '../components/FileTree.js'
import { api } from '../lib/api.js'
import { dirsCollection, makeFolder, newNote, notesCollection } from '../lib/db.js'
import { usePoll } from '../lib/usePoll.js'
import styles from './__root.module.css'
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

const SIDEBAR_KEY = 'flow-md-sidebar'

function Shell() {
  // The sidebar renders straight from the notes collection — synced (and
  // localStorage-cached, so it also renders offline) by the db layer.
  const { data: notes } = useLiveQuery((q) => q.from({ note: notesCollection }))
  const { data: dirs } = useLiveQuery((q) => q.from({ dir: dirsCollection }))
  const health = usePoll(() => api.health(), [], 5000)
  const navigate = useNavigate()

  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) !== 'closed',
  )
  const [paletteOpen, setPaletteOpen] = useState(false)

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      localStorage.setItem(SIDEBAR_KEY, open ? 'closed' : 'open')
      return !open
    })
  }

  useHotkey('Mod+K', () => setPaletteOpen((o) => !o), { preventDefault: true })
  useHotkey('Mod+B', toggleSidebar, { preventDefault: true })

  const addNote = async () => {
    const name = window.prompt('New note path (e.g. notes/idea.md):')
    if (!name) return
    const path = name.endsWith('.md') ? name : `${name}.md`
    // Optimistic: the tree shows the note immediately; navigate right away.
    void newNote(path)
    void navigate({ to: '/note/$', params: { _splat: path } })
  }

  const addFolder = () => {
    const name = window.prompt('New folder path (e.g. projects/ideas):')
    if (name) void makeFolder(name)
  }

  return (
    <div className={styles.shell}>
      {sidebarOpen ? (
        <aside className={styles.sidebar} data-testid="sidebar">
          <div className={styles.sidebarHead}>
            <span className={styles.brand}>flow-md</span>
            <span>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => void addNote()}
              >
                + note
              </button>{' '}
              <button
                type="button"
                className={styles.ghost}
                title="new folder"
                onClick={addFolder}
              >
                + 📁
              </button>{' '}
              <button
                type="button"
                className={styles.ghost}
                title="hide sidebar (⌘B)"
                onClick={toggleSidebar}
                data-testid="sidebar-hide"
              >
                «
              </button>
            </span>
          </div>
          {health.error && (
            <p className="offline">
              server unreachable at <code>{api.base}</code> — showing cached
              vault
            </p>
          )}
          {health.data?.error && <p className="offline">{health.data.error}</p>}
          <FileTree
            files={(notes ?? []).map((n) => n.path)}
            dirs={(dirs ?? []).map((d) => d.path)}
          />
        </aside>
      ) : (
        <button
          type="button"
          className={styles.reveal}
          title="show sidebar (⌘B)"
          onClick={toggleSidebar}
          data-testid="sidebar-show"
        >
          »
        </button>
      )}
      <main className={styles.content}>
        <Outlet />
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={[
          { label: 'Toggle sidebar', run: toggleSidebar },
          { label: 'New note', run: () => void addNote() },
          { label: 'Go to vault overview', run: () => void navigate({ to: '/' }) },
        ]}
      />
    </div>
  )
}
