// Root route: the whole HTML document (Start hydrates `document` directly in
// SPA mode) plus the persistent two-pane layout — file-tree sidebar on the
// left (toggleable, Mod+B), the active note on the right, and the Mod+K
// command palette floating above everything.

import { FlowMdHostProvider } from '@flow-md/view-api'
import { FileTree } from '@flow-md/view-filetree'
import { useLiveQuery } from '@tanstack/react-db'
import { useHotkey } from '@tanstack/react-hotkeys'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { CommandPalette } from '../components/CommandPalette.js'
import { api } from '../lib/api.js'
import { notesCollection } from '../lib/db.js'
import { makeHost } from '../lib/host.js'
import { toggleRawView } from '../lib/rawView.js'
import { themeInitScript, toggleTheme } from '../lib/theme.js'
import { usePoll } from '../lib/usePoll.js'
import { resolveWikiTarget } from '../lib/wiki.js'
import styles from './__root.module.css'
import '../index.css'

const FILES_QUERY = 'File(path, mtime)'
const FOLDERS_QUERY = 'Folder(path)'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'flow-md' },
    ],
    // Sets <html data-theme> before first paint — the palette in index.css
    // keys off it, so the shell can't flash the wrong theme.
    scripts: [{ children: themeInitScript }],
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
  const health = usePoll(() => api.health(), [], 5000)
  const navigate = useNavigate()
  const location = useLocation()

  // The single app-level host: provided to the whole tree so the sidebar
  // FileTree (and any in-tree view component) can reach it, and read by the
  // editor (useFlowMd) to thread into its MDX widgets. Query/file hooks and
  // mutations are static; navigation + wiki resolution close over the router
  // and the live file list.
  const { data: notes } = useLiveQuery((q) => q.from({ note: notesCollection }))
  const filesRef = useRef<string[]>([])
  filesRef.current = (notes ?? []).map((n) => n.path)
  const host = useMemo(
    () =>
      makeHost({
        openNote: (p) => void navigate({ to: '/note/$', params: { _splat: p } }),
        resolveWiki: (t) => resolveWikiTarget(t, filesRef.current),
      }),
    [navigate],
  )

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

  const addNote = () => {
    const name = window.prompt('New note path (e.g. notes/idea.md):')
    if (!name) return
    const path = name.endsWith('.md') ? name : `${name}.md`
    // New note = empty file (insert a File row); navigate once it's created.
    void host
      .insertRow({ rel: 'File', row: [path, 0] })
      .then(() => navigate({ to: '/note/$', params: { _splat: path } }))
  }

  const addFolder = () => {
    const name = window.prompt('New folder path (e.g. projects/ideas):')
    if (name) void host.insertRow({ rel: 'Folder', row: [name] })
  }

  // `/` renders the vault's index.md, so mirror that in the tree highlight.
  const activePath = location.pathname.startsWith('/note/')
    ? decodeURIComponent(location.pathname.slice('/note/'.length))
    : location.pathname === '/'
      ? 'index.md'
      : undefined

  return (
    <FlowMdHostProvider host={host}>
      <div className={styles.shell}>
        {/* The sidebar is just the library — no chrome of its own. Every
            command (new note/folder, theme, raw view, the sidebar itself)
            lives in the ⌘K palette or on a hotkey (⌘B). */}
        {sidebarOpen && (
          <aside className={styles.sidebar} data-testid="sidebar">
            {health.error && (
              <p className="offline">
                server unreachable at <code>{api.base}</code> — showing cached
                vault
              </p>
            )}
            {health.data?.error && <p className="offline">{health.data.error}</p>}
            <FileTree
              files={FILES_QUERY}
              folders={FOLDERS_QUERY}
              {...(activePath !== undefined ? { activePath } : {})}
            />
          </aside>
        )}
        <main className={styles.content}>
          <Outlet />
        </main>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          commands={[
            { label: 'New note', run: addNote },
            { label: 'New folder', run: addFolder },
            { label: 'Toggle dark/light theme', run: toggleTheme },
            { label: 'Toggle sidebar', run: toggleSidebar },
            { label: 'Toggle raw source view', run: toggleRawView },
            { label: 'Go to index', run: () => void navigate({ to: '/' }) },
          ]}
        />
      </div>
    </FlowMdHostProvider>
  )
}
