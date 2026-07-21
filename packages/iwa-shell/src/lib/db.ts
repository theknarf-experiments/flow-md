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
import { ulid } from './ulid.js'
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
  /** `<space>\n<block id>`, or the link's start when it hasn't got one.
   *
   *  Datalog is set semantics, so a row has to carry something that tells two
   *  identical links apart. A span does, but it moves whenever the file is
   *  edited above it — every row below an edit changes identity and its tab
   *  reloads. A block id doesn't move, so the browser writes one after each
   *  link it opens: `- [Example](https://example.com/) ^01HQ8P…`. */
  id: string
  /** The `^id` written after the link, when there is one. */
  block: string | null
  /** How deep the tab sits, from how far its line is indented. Two spaces to
   *  a level, which is what markdown lists use. */
  depth: number
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

/** The block ids in those same files. A separate query because Datalog has no
 *  outer join: asking for links *and* their id in one would hide every link
 *  that hasn't got one yet. */
const BLOCK_QUERY = 'Frontmatter(path, "type", "space"), MdBlockId(path, block, line)'

/** How far each line is indented — which is the tree. */
const INDENT_QUERY = 'Frontmatter(path, "type", "space"), MdIndent(path, line, spaces)'

/** Markdown's own step, and the one the sidebar draws. */
export const INDENT_STEP = 2

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
  const [rows, blocks, indents, spaces] = await Promise.all([
    vault.run(TAB_QUERY),
    vault.run(BLOCK_QUERY),
    vault.run(INDENT_QUERY),
    loadSpaces(),
  ])
  if (rows.error) throw new Error(rows.error)
  if (blocks.error) throw new Error(blocks.error)
  if (indents.error) throw new Error(indents.error)
  const indentOf = new Map(
    (indents.rows as [string, number, number][]).map(([path, line, spaces_]) => [
      `${path}\n${line}`,
      spaces_,
    ]),
  )
  const pinned = new Map(spaces.map((s) => [s.id, s.pinned]))
  // A block id belongs to the line it closes.
  const blockOf = new Map(
    (blocks.rows as [string, string, number][]).map(([path, block, line]) => [
      `${path}\n${line}`,
      block,
    ]),
  )
  type Row = [string, number, number, string, number, number, number, string, string, string]
  const all = rows.rows as Row[]

  // Anything the browser hasn't named yet — a link somebody wrote by hand,
  // or one written a moment ago. Naming it is a write, so it happens out of
  // band and the row turns up on the next read.
  //
  // Until then the link isn't a tab. A row whose key changes is a row the
  // collection keeps twice: the old key is never removed, so the tab would
  // appear once under its span and again under its id.
  const unnamed = all.filter(([space, , , , line]) => !blockOf.has(`${space}\n${line}`))
  if (unnamed.length > 0) void nameLinks(unnamed.map(([space, , , , line]) => [space, line]))

  return all
    .filter(([space, , , , line]) => blockOf.has(`${space}\n${line}`))
    .map(([space, node, parent, type, line, start, end, kind, url, title]) => ({
      block: blockOf.get(`${space}\n${line}`)!,
      id: `${space}\n${blockOf.get(`${space}\n${line}`)!}`,
      depth: Math.floor((indentOf.get(`${space}\n${line}`) ?? 0) / INDENT_STEP),
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
/** Give links a name of their own: `- [Example](https://…) ^01HQ8P…`.
 *
 *  Appending to a line doesn't renumber any, so a batch can be written from
 *  one read. Failures are ignored on purpose — a line that already has an id
 *  is not a problem worth a dialog. */
async function nameLinks(lines: Array<[space: string, line: number]>): Promise<void> {
  for (const [space, line] of lines) {
    await vault.insert('MdBlockId', [space, ulid(), line]).catch(() => undefined)
  }
  await tabsCollection.utils.refetch()
}

const blockQuery = (space: string) =>
  `MdBlockId(${JSON.stringify(space)}, block, line)`

/** Move a link so it sits before another one — or last, when there's nothing
 *  to sit before.
 *
 *  A line can't be moved as such; it's removed and written again. That's four
 *  edits because the id goes with it: without carrying the same `^id` across,
 *  the tab would come back as a different tab and reload the page it was
 *  showing. The line numbers are re-read in between, since taking a line out
 *  renumbers everything under it. */
/** Move a tab in or out of the level it sits at, by rewriting the
 *  indentation of its line. Markdown nesting is indentation, so this is the
 *  whole of it. */
export async function setDepth(tab: Tab, depth: number): Promise<void> {
  const spaces = Math.max(0, depth) * INDENT_STEP
  if (spaces === tab.depth * INDENT_STEP) return
  await vault.update(INDENT_QUERY, [tab.space, tab.line, tab.depth * INDENT_STEP], 'spaces', spaces)
  await tabsCollection.utils.refetch()
}

export async function moveLink(tab: Tab, before: Tab | null, depth?: number): Promise<void> {
  const id = tab.block ?? ulid()
  if (tab.block) {
    await vault.delete(blockQuery(tab.space), [tab.block, tab.line], 'MdBlockId')
  }
  await vault.delete(TAB_QUERY, rowOf(tab), 'MdNode')

  const now = await vault.run(TAB_QUERY)
  const at = before
    ? (now.rows as [string, ...unknown[]][]).find(
        (r) => r[0] === before.space && r[8] === before.url && r[9] === before.title,
      )
    : undefined
  // 0 appends; anything else inserts before that line.
  const line = at ? Number(at[4]) : 0
  const put = await vault.insert('LinkLabel', [tab.space, tab.url, tab.title, line])
  if (put.error) {
    // The link has already been taken out, so a failure here would lose it.
    await vault.insert('LinkLabel', [tab.space, tab.url, tab.title, 0])
    throw new Error(`move failed, link put back: ${put.error}`)
  }

  // Where it actually landed, so the id lands on the same line.
  const written = await vault.run(TAB_QUERY)
  const landed = (written.rows as [string, ...unknown[]][])
    .filter((r) => r[0] === tab.space && r[8] === tab.url && r[9] === tab.title)
    .map((r) => Number(r[4]))
  const target = line === 0 ? Math.max(...landed) : line
  await vault.insert('MdBlockId', [tab.space, id, target])
  // The line was written at the left margin; put it back at the level the
  // drop asked for.
  const want = (depth ?? tab.depth) * INDENT_STEP
  if (want > 0) {
    await vault.update(INDENT_QUERY, [tab.space, target, 0], 'spaces', want)
  }
  await tabsCollection.utils.refetch()
}

export async function addLink(space: string, url: string, title: string): Promise<void> {
  // Line 0 means append; the reparse decides where it really goes.
  await vault.insert('LinkLabel', [space, url, title, 0])
  // Then name it, without waiting for the read that would find it anyway:
  // a tab that takes a poll to appear is a tab that looks broken.
  const written = await vault.run(TAB_QUERY)
  const line = (written.rows as [string, ...unknown[]][])
    .filter((r) => r[0] === space && r[8] === url)
    .map((r) => Number(r[4]))
    .sort((a, b) => b - a)[0]
  if (line !== undefined) await nameLinks([[space, line]])
  else await tabsCollection.utils.refetch()
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
