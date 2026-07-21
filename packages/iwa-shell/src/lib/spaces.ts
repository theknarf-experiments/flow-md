// Spaces, as markdown files.
//
// A space is a file with `type: space` in its frontmatter. Its name, emoji
// and colour are frontmatter keys; its tabs are the links in the body, in the
// order they're written; its pinned tabs are a `pinned:` list. There is no
// other store — opening a tab appends a link, closing one removes that line,
// renaming the space rewrites a YAML value.
//
// The queries are the whole interface. Everything here is Datalog against the
// vault plus the write that undoes it.

import { type Cell, vault } from './vault.js'

export interface Space {
  /** The vault-relative path of the file this space is — and, because a space
   *  is that file, its identity. */
  id: string
  name: string
  emoji: string
  hue: number
  pinned: string[]
  /** Every space browses in its own container; the file's path names it. */
  partition: string
}

export interface VaultTab {
  url: string
  title: string
  /** Where the link is written, which is also what orders the tabs. */
  line: number
}

/** Files that declare themselves spaces, with everything else about them. */
const SPACE_KEYS = 'Frontmatter(path, "type", "space"), Frontmatter(path, key, value)'

/** A space's tabs: the links in its body, with what they're called. */
const tabsOf = (path: string) => `LinkLabel(${JSON.stringify(path)}, dst, text, line)`

/** The same query the shell writes through, so a row it read is a row the
 *  vault can trace back. */
export const TAB_QUERY = tabsOf

export async function loadSpaces(): Promise<Space[]> {
  const result = await vault.run(SPACE_KEYS)
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
    .map(({ order: _order, ...space }) => space)
}

export async function loadTabs(path: string): Promise<VaultTab[]> {
  const result = await vault.run(tabsOf(path))
  if (result.error) throw new Error(result.error)
  return (result.rows as [string, string, number][])
    .map(([url, title, line]) => ({ url, title, line }))
    .sort((a, b) => a.line - b.line)
}

/** Opening a tab writes a link. The line comes back from the reparse, so 0
 *  here means "append". */
export function openTab(path: string, url: string, title: string) {
  return vault.insert('LinkLabel', [path, url, title, 0])
}

export function closeTab(path: string, tab: VaultTab) {
  return vault.delete(tabsOf(path), [tab.url, tab.title, tab.line])
}

export function renameTab(path: string, tab: VaultTab, title: string) {
  return vault.update(tabsOf(path), [tab.url, tab.title, tab.line], 'text', title)
}

/** Frontmatter edits: the space's own name, emoji and colour. */
export function setSpaceKey(path: string, key: string, from: Cell, to: Cell) {
  return vault.update(
    `Frontmatter(${JSON.stringify(path)}, key, value)`,
    [key, from],
    'value',
    to,
  )
}

export function pin(path: string, url: string) {
  return vault.insert('Frontmatter', [path, 'pinned', url])
}

export function unpin(path: string, url: string) {
  return vault.delete(`Frontmatter(${JSON.stringify(path)}, key, value)`, ['pinned', url])
}

/** Make a new space: a file, then the frontmatter that declares it one.
 *  Returns an error message, or null when it worked. */
export async function create(
  path: string,
  meta: { name: string; emoji: string; hue: number },
): Promise<string | null> {
  // File is a system relation — the vault turns an insert into a real file.
  const made = await vault.insert('File', [path, 0])
  if (made.error) return made.error
  for (const [key, value] of [
    ['type', 'space'],
    ['name', meta.name],
    ['emoji', meta.emoji],
    ['hue', meta.hue],
  ] as [string, Cell][]) {
    const wrote = await vault.insert('Frontmatter', [path, key, value])
    if (wrote.error) return wrote.error
  }
  return null
}

/** Point an existing link somewhere else — a tab that navigated. */
export function retarget(path: string, tab: VaultTab, url: string) {
  return vault.update(tabsOf(path), [tab.url, tab.title, tab.line], 'dst', url)
}
