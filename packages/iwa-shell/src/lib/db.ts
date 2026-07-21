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
  /** `<space>\n<start>` — where the link is written, in bytes.
   *
   *  Datalog is set semantics: two identical links would be one row if the
   *  row didn't say where each of them is. The span does, by construction, so
   *  the same page opened twice is two tabs, the way it is in any browser. */
  id: string
  space: string
  url: string
  title: string
  line: number
  /** Byte range of the link in its file — the whole row the vault needs to
   *  trace an edit back to it. */
  node: number
  parent: number
  type: string
  start: number
  end: number
  kind: string
  pinned: boolean
}

/** Files that declare themselves spaces, with everything else about them. */
const SPACE_QUERY = 'Frontmatter(path, "type", "space"), Frontmatter(path, key, value)'

/** Every link in every space, as nodes of the tree rather than through the
 *  LinkLabel view.
 *
 *  The view is the friendlier shape, but it says which line a link is on and
 *  not where on that line — so two links to the same page would be
 *  indistinguishable to a set. Asking the tree directly costs one join and
 *  returns the node and its span, which makes every row unique and gives the
 *  vault everything it needs to trace an edit back. */
const TAB_QUERY = [
  'Frontmatter(path, "type", "space")',
  'MdNode(path, node, parent, type, line, start, end)',
  'MdProp(path, node, "link", kind)',
  'MdProp(path, node, "url", dst)',
  'MdNodeText(path, node, text)',
].join(', ')

const frontmatterOf = (space: string) =>
  `Frontmatter(${JSON.stringify(space)}, key, value)`

/** The row as the query returned it, which is what an edit is traced from. */
const rowOf = (t: Tab): Cell[] => [
  t.space,
  t.node,
  t.parent,
  t.type,
  t.line,
  t.start,
  t.end,
  t.kind,
  t.url,
  t.title,
]

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
  type Row = [string, number, number, string, number, number, number, string, string, string]
  return (rows.rows as Row[])
    .map(([space, node, parent, type, line, start, end, kind, url, title]) => ({
      id: `${space}\n${start}`,
      space,
      url,
      title,
      line,
      node,
      parent,
      type,
      start,
      end,
      kind,
      pinned: (pinned.get(space) ?? []).includes(url),
    }))
    // The order links are written in is the order tabs appear.
    .sort((a, b) => a.space.localeCompare(b.space) || a.start - b.start)
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
      void spacesCollection.utils.refetch()
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
      void spacesCollection.utils.refetch()
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

/** Add a link to a space's file.
 *
 *  Not a collection insert: a row is identified by where it's written, and
 *  nothing knows that until the vault has written it. Rather than invent a
 *  provisional key — which would build a guest, then throw it away when the
 *  real row arrived — this writes and reads back. One round trip, and the
 *  tab that appears is the real one. */
export async function addLink(space: string, url: string, title: string): Promise<void> {
  // Line 0 means append; the reparse decides where it really goes.
  await vault.insert('LinkLabel', [space, url, title, 0])
  await tabsCollection.utils.refetch()
}

export const tabsCollection = createCollection(
  queryCollectionOptions<Tab>({
    id: 'tabs',
    queryKey: ['tabs'],
    queryFn: loadTabs,
    getKey: (t) => t.id,
    queryClient,
    refetchInterval: 1500,
    onUpdate: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const before = m.original as Tab
        const after = m.modified as Tab
        // The row names the node, so the vault knows which link this is even
        // when the file holds several to the same page.
        //
        // Target first, then label. Rewriting `[label](url)` changes how far
        // the link reaches, and the row carries that extent — so the second
        // edit has to say where the link is *now*.
        //
        // Worked out rather than read back: inside a mutation handler the
        // collection is showing its own optimistic row, not the file, so
        // asking it would return the values we're in the middle of writing.
        // A url of a different length moves the end by exactly that much.
        let row = before
        if (before.url !== after.url) {
          await vault.update(TAB_QUERY, rowOf(row), 'dst', after.url)
          row = { ...row, url: after.url, end: row.end + (after.url.length - before.url.length) }
        }
        if (before.title !== after.title) {
          await vault.update(TAB_QUERY, rowOf(row), 'text', after.title)
        }
      }
      void tabsCollection.utils.refetch()
    },
    onDelete: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        // Removing a tab removes the link node; the frontmatter the query
        // also reaches is what marks the file as a space.
        await vault.delete(TAB_QUERY, rowOf(m.original as Tab), 'MdNode')
      }
      void tabsCollection.utils.refetch()
    },
  }),
)
