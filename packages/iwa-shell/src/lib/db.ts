// The shell's data layer: two TanStack DB collections over the vault, with
// the Datalog server as the authority.
//
//   spaces  one row per file with `type: space` in its frontmatter — its
//           name, emoji, colour and pinned urls.
//   tabs    one row per link inside those files, keyed by the space it's in
//           and the line it's on.
//
// Both poll, which is how a change made in an editor reaches the browser: the
// query result *is* the state, so a link deleted in Vim becomes a tab that
// closes here, without the shell keeping a model of its own to reconcile.
// Writes go through the collections' mutation handlers, which post the fact
// edit and refetch — optimistic locally, authoritative remotely.
//
// The same cadence and shape as the app's collections, deliberately: it's the
// same server and the same problem.

import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection } from '@tanstack/react-db'
import { type Cell, vault } from './vault.js'

export interface Space {
  /** The vault-relative path of the file this space is — and, because a space
   *  is that file, its identity. */
  id: string
  name: string
  emoji: string
  hue: number
  pinned: string[]
  /** Guests are partitioned per space, so spaces are real containers:
   *  separate cookies, storage and logins. Named after the file. */
  partition: string
  /** `order:` in the frontmatter, or +Infinity. A collection is a keyed map
   *  with no order of its own, so the rail sorts by this rather than by the
   *  order rows happen to arrive in. */
  order: number
}

export interface Tab {
  /** `<space>\n<line>` — a link is identified by where it's written, which is
   *  also what keeps two tabs on the same url distinct. */
  id: string
  space: string
  url: string
  title: string
  line: number
  pinned: boolean
}

/** Files that declare themselves spaces, with everything else about them. */
const SPACE_QUERY = 'Frontmatter(path, "type", "space"), Frontmatter(path, key, value)'

/** Every link in every space, in one query rather than one per space. */
const TAB_QUERY =
  'Frontmatter(path, "type", "space"), LinkLabel(path, dst, text, line)'

const tabsOf = (space: string) => `LinkLabel(${JSON.stringify(space)}, dst, text, line)`
const frontmatterOf = (space: string) =>
  `Frontmatter(${JSON.stringify(space)}, key, value)`

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

async function loadSpaces(): Promise<Space[]> {
  const result = await vault.run(SPACE_QUERY)
  if (result.error) throw new Error(result.error)

  const byPath = new Map<string, Map<string, string[]>>()
  for (const [path, key, value] of result.rows as [string, string, string][]) {
    const keys = byPath.get(path) ?? new Map<string, string[]>()
    keys.set(key, [...(keys.get(key) ?? []), value])
    byPath.set(path, keys)
  }

  return [...byPath.entries()]
    .map(([path, keys]) => ({
      id: path,
      name: keys.get('name')?.[0] ?? path.replace(/\.md$/, ''),
      emoji: keys.get('emoji')?.[0] ?? '•',
      hue: Number(keys.get('hue')?.[0] ?? 250),
      pinned: keys.get('pinned') ?? [],
      partition: `persist:${path.replace(/[^\w]/g, '-')}`,
      order: Number(keys.get('order')?.[0] ?? Number.POSITIVE_INFINITY),
    }))
    // Query results are a set; the rail is a row. `order:` in the frontmatter
    // decides, and anything without one sorts by name after those that have.
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

async function loadTabs(): Promise<Tab[]> {
  const [rows, spaces] = await Promise.all([vault.run(TAB_QUERY), loadSpaces()])
  if (rows.error) throw new Error(rows.error)
  const pinned = new Map(spaces.map((s) => [s.id, s.pinned]))
  return (rows.rows as [string, string, string, number][])
    .map(([space, url, title, line]) => ({
      id: `${space}\n${line}`,
      space,
      url,
      title,
      line,
      pinned: (pinned.get(space) ?? []).includes(url),
    }))
    // The order links are written in is the order tabs appear.
    .sort((a, b) => a.space.localeCompare(b.space) || a.line - b.line)
}

export const spacesCollection = createCollection(
  queryCollectionOptions<Space>({
    id: 'spaces',
    queryKey: ['spaces'],
    queryFn: loadSpaces,
    getKey: (s) => s.id,
    queryClient,
    refetchInterval: 1500,
    onUpdate: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const before = m.original as Space
        const after = m.modified as Space
        for (const key of ['name', 'emoji', 'hue'] as const) {
          if (before[key] === after[key]) continue
          await vault.update(
            frontmatterOf(before.id),
            [key, String(before[key])],
            'value',
            after[key],
          )
        }
        // Pinning is adding a url to a list, not editing a value.
        for (const url of after.pinned.filter((u) => !before.pinned.includes(u))) {
          await vault.insert('Frontmatter', [before.id, 'pinned', url])
        }
        for (const url of before.pinned.filter((u) => !after.pinned.includes(u))) {
          await vault.delete(frontmatterOf(before.id), ['pinned', url])
        }
      }
      void tabsCollection.utils.refetch()
    },
    onInsert: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const space = m.modified as Space
        // File is a system relation: inserting one writes a real file.
        await vault.insert('File', [space.id, 0])
        for (const [key, value] of [
          ['type', 'space'],
          ['name', space.name],
          ['emoji', space.emoji],
          ['hue', space.hue],
        ] as [string, Cell][]) {
          await vault.insert('Frontmatter', [space.id, key, value])
        }
      }
    },
    onDelete: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const space = m.original as Space
        await vault.delete('File(path, mtime)', [space.id, 0])
      }
      void tabsCollection.utils.refetch()
    },
  }),
)

export const tabsCollection = createCollection(
  queryCollectionOptions<Tab>({
    id: 'tabs',
    queryKey: ['tabs'],
    queryFn: loadTabs,
    getKey: (t) => t.id,
    queryClient,
    refetchInterval: 1500,
    onInsert: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const tab = m.modified as Tab
        // Line 0 means "append"; the real line comes back from the reparse,
        // which is also why the refetch below matters.
        await vault.insert('LinkLabel', [tab.space, tab.url, tab.title, 0])
      }
    },
    onUpdate: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const before = m.original as Tab
        const after = m.modified as Tab
        const query = tabsOf(before.space)
        const row = [before.url, before.title, before.line]
        if (before.url !== after.url) await vault.update(query, row, 'dst', after.url)
        if (before.title !== after.title) {
          // The row moved if the url just changed, so re-read it from what
          // the file now says rather than from the row we started with.
          const moved = before.url !== after.url ? [after.url, before.title, before.line] : row
          await vault.update(query, moved, 'text', after.title)
        }
      }
    },
    onDelete: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const tab = m.original as Tab
        await vault.delete(tabsOf(tab.space), [tab.url, tab.title, tab.line])
      }
    },
  }),
)
