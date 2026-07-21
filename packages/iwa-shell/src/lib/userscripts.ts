// Extensions, as notes.
//
// A userscript is a markdown file with `type: userscript` in its frontmatter
// and a js code block in its body:
//
//     ---
//     type: userscript
//     match: https://news.ycombinator.com/*
//     name: Wider HN
//     ---
//
//     ```js
//     document.querySelector('#hnmain').width = '100%'
//     ```
//
// Which is the same trick the rest of the shell plays: the vault is the
// database, so an extension is a note and enabling one is writing a file. The
// script is handed to Controlled Frame's addContentScripts, so it runs at
// document_idle on every matching page and survives navigation — the guest
// applies it itself rather than the shell re-injecting on each load.

import { vault } from './vault.js'

export interface UserScript {
  /** The note it comes from, which is its identity. */
  path: string
  name: string
  /** Match patterns, in the extension sense: https://host/* and friends. */
  matches: string[]
  code: string
  /** Whether it should run at all — `enabled: false` in the frontmatter turns
   *  one off without deleting the note. */
  enabled: boolean
}

/** Files that say they're userscripts, with everything else about them. */
const META_QUERY =
  'Frontmatter(path, "type", "userscript"), Frontmatter(path, key, value)'

/** The js in those files. Asked of the tree rather than CodeBlock, because
 *  CodeBlock says where a block is and not what it says. */
const CODE_QUERY = [
  'Frontmatter(path, "type", "userscript")',
  'MdNode(path, id, parent, "code", line, start, end)',
  'MdProp(path, id, "lang", lang)',
  'MdNodeText(path, id, code)',
].join(', ')

export async function loadUserScripts(): Promise<UserScript[]> {
  const [meta, code] = await Promise.all([vault.run(META_QUERY), vault.run(CODE_QUERY)])
  if (meta.error || code.error) return []

  const byPath = new Map<string, Map<string, string[]>>()
  for (const [path, key, value] of meta.rows as [string, string, string][]) {
    const keys = byPath.get(path) ?? new Map<string, string[]>()
    keys.set(key, [...(keys.get(key) ?? []), String(value)])
    byPath.set(path, keys)
  }

  // A note can hold more than one block; they're joined, the way a file of
  // several statements is still one script.
  const codeByPath = new Map<string, string[]>()
  for (const row of code.rows as [string, number, number, number, number, number, string, string][]) {
    const [path, , , , , , lang, body] = row
    if (!/^(js|javascript)$/i.test(String(lang))) continue
    codeByPath.set(path, [...(codeByPath.get(path) ?? []), String(body)])
  }

  const scripts: UserScript[] = []
  for (const [path, keys] of byPath) {
    const body = codeByPath.get(path)
    if (!body?.length) continue
    scripts.push({
      path,
      name: keys.get('name')?.[0] ?? path.replace(/\.mdx?$/, ''),
      // `match:` may be given more than once, the way a manifest lists several.
      matches: keys.get('match') ?? ['<all_urls>'],
      code: body.join('\n\n'),
      enabled: (keys.get('enabled')?.[0] ?? 'true') !== 'false',
    })
  }
  return scripts.sort((a, b) => a.path.localeCompare(b.path))
}

/** Does a url fall under one of an extension match pattern's? Deliberately the
 *  subset that gets used in practice — scheme://host/path with `*` wildcards,
 *  plus `<all_urls>` — rather than the full grammar, and anything unparseable
 *  matches nothing rather than everything. */
export function matches(patterns: string[], url: string): boolean {
  return patterns.some((pattern) => {
    if (pattern === '<all_urls>' || pattern === '*') return true
    const rx = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      // A leading *. in the host means "this domain or any subdomain".
      .replace(/^(\w+|\\\*):\\\/\\\/\\\*\\\./, '$1://([^/]+\\.)?')
      .replace(/\*/g, '.*')
    try {
      return new RegExp(`^${rx}$`).test(url)
    } catch {
      return false
    }
  })
}
