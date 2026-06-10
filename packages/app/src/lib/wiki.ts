// Wiki-link resolution, shared by the live editor, the graph view and the
// command palette. Mirrors the markdown plugin's WIKILINK pattern so the app
// links exactly what the server indexes.

/** Resolve a wiki target against the vault's file list, Obsidian-style:
 *  exact path match first (as written, then with .md/.mdx appended), then a
 *  unique basename match. Returns null when nothing (or several things)
 *  match. */
export function resolveWikiTarget(
  target: string,
  files: readonly string[],
): string | null {
  const candidates = [target, `${target}.md`, `${target}.mdx`]
  for (const c of candidates) {
    if (files.includes(c)) return c
  }
  const names = new Set(candidates.map((c) => c.split('/').at(-1)!.toLowerCase()))
  const hits = files.filter((f) =>
    names.has(f.split('/').at(-1)?.toLowerCase() ?? ''),
  )
  return hits.length === 1 ? hits[0]! : null
}
