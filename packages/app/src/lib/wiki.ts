// remark plugin turning `[[Target]]` / `[[Target|label]]` spans inside text
// nodes into link nodes with a `wiki:` href, plus the resolver that maps a
// wiki target to a vault file. Mirrors the markdown plugin's WIKILINK regex
// so the app links exactly what the server indexes.

import type { Link, Parent, Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

const WIKILINK = /\[\[([^\]]+)\]\]/g

export function remarkWikiLinks() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return
      const value = node.value
      const matches = [...value.matchAll(WIKILINK)]
      if (matches.length === 0) return

      const out: Array<Text | Link> = []
      let cursor = 0
      for (const m of matches) {
        const at = m.index ?? 0
        if (at > cursor) out.push(text(value.slice(cursor, at)))
        const inner = m[1] ?? ''
        const [targetPart, label] = inner.split('|')
        const target = (targetPart ?? '').split('#')[0]!.trim()
        if (target) {
          out.push({
            type: 'link',
            url: `wiki:${target}`,
            children: [text((label ?? inner).trim() || target)],
          })
        } else {
          out.push(text(m[0]))
        }
        cursor = at + m[0].length
      }
      if (cursor < value.length) out.push(text(value.slice(cursor)))
      ;(parent as Parent).children.splice(index, 1, ...out)
      return index + out.length
    })
  }
}

function text(value: string): Text {
  return { type: 'text', value }
}

/** Resolve a wiki target against the vault's file list, Obsidian-style:
 *  exact path match first, then unique basename match (with or without the
 *  .md extension). Returns null when nothing (or several things) match. */
export function resolveWikiTarget(
  target: string,
  files: readonly string[],
): string | null {
  const want = target.endsWith('.md') ? target : `${target}.md`
  if (files.includes(want)) return want
  if (files.includes(target)) return target
  const base = want.toLowerCase()
  const hits = files.filter((f) => {
    const name = f.split('/').at(-1)?.toLowerCase()
    return name === base
  })
  return hits.length === 1 ? hits[0]! : null
}
