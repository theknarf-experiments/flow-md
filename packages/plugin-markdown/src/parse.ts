// Pure markdown → facts + rule/query extraction. No filesystem access: the
// caller supplies path, content and mtime so this stays trivially testable.
//
// Structure becomes EDB facts (see schema.ts). Fenced code blocks are routed
// by language:
//   ```datalog        → a rule block (program source, collected into .rule)
//   ```datalog-query  → a query block (rendered inline by the editor)
//   anything else     → a CodeBlock(path, lang, line) fact
// Wiki-links ([[Target]]) and #tags are scraped from text nodes, so they
// never pick up matches inside code spans or fenced blocks.

import type { Fact, ParseResult } from '@flow-md/plugin-api'
import type { Code, Heading, Link, ListItem, Root, Text, Yaml } from 'mdast'
import { toString as mdToString } from 'mdast-util-to-string'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parse as parseYaml } from 'yaml'

export const RULE_LANG = 'datalog'
export const QUERY_LANG = 'datalog-query'

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)

const WIKILINK = /\[\[([^\]]+)\]\]/g
// A tag starts at a word boundary, begins with a letter, and may nest (a/b).
const TAG = /(?:^|\s)#([A-Za-z][\w/-]*)/g

export function parseMarkdown(
  path: string,
  content: string,
  mtime: number,
): ParseResult {
  const tree = processor.parse(content) as Root
  const facts: Fact[] = [{ rel: 'File', row: [path, mtime] }]
  const rules: string[] = []
  const queries: ParseResult['queries'] = []

  walk(tree, (node) => {
    switch (node.type) {
      case 'yaml':
        emitFrontmatter(path, (node as Yaml).value, facts)
        break
      case 'heading': {
        const h = node as Heading
        facts.push({
          rel: 'Heading',
          row: [path, h.depth, mdToString(h), lineOf(node)],
        })
        break
      }
      case 'link':
        facts.push({ rel: 'Link', row: [path, (node as Link).url, 'md'] })
        break
      case 'listItem': {
        // A GFM task-list item (`- [ ]` / `- [x]`) carries a boolean `checked`;
        // plain list items have it null/undefined. Use the item's own leading
        // paragraph so nested sub-items don't bleed into the text (they emit
        // their own Task facts as the walk visits them).
        const li = node as ListItem
        if (typeof li.checked === 'boolean') {
          const para = li.children.find((c) => c.type === 'paragraph')
          const text = (para ? mdToString(para) : mdToString(li)).trim()
          const status = li.checked ? 'closed' : 'open'
          facts.push({ rel: 'Task', row: [path, status, text, lineOf(node)] })
        }
        break
      }
      case 'code': {
        const c = node as Code
        const lang = (c.lang ?? '').toLowerCase()
        if (lang === RULE_LANG) {
          rules.push(c.value)
        } else if (lang === QUERY_LANG) {
          queries.push({ line: lineOf(node), source: c.value })
        } else {
          facts.push({ rel: 'CodeBlock', row: [path, c.lang ?? '', lineOf(node)] })
        }
        break
      }
      case 'text': {
        const value = (node as Text).value
        for (const m of value.matchAll(WIKILINK)) {
          const target = (m[1] ?? '').split('|')[0]!.split('#')[0]!.trim()
          if (target) facts.push({ rel: 'Link', row: [path, target, 'wiki'] })
        }
        for (const m of value.matchAll(TAG)) {
          facts.push({ rel: 'Tag', row: [path, m[1]!] })
        }
        break
      }
    }
  })

  return { facts: dedup(facts), rules, queries }
}

interface UNode {
  type: string
  position?: { start?: { line?: number } }
  children?: UNode[]
}

function walk(node: UNode, visit: (n: UNode) => void): void {
  visit(node)
  if (node.children) for (const child of node.children) walk(child, visit)
}

function lineOf(node: UNode): number {
  return node.position?.start?.line ?? 0
}

function emitFrontmatter(path: string, yamlSrc: string, facts: Fact[]): void {
  let data: unknown
  try {
    data = parseYaml(yamlSrc)
  } catch {
    return
  }
  if (!data || typeof data !== 'object') return
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const items = Array.isArray(value) ? value : [value]
    for (const item of items) {
      const s = item == null ? '' : String(item)
      facts.push({ rel: 'Frontmatter', row: [path, key, s] })
      // Numeric values also get a typed fact so rules can compare/aggregate
      // them numerically (the string form sorts lexicographically).
      if (typeof item === 'number' && Number.isFinite(item)) {
        facts.push({ rel: 'FrontmatterNumber', row: [path, key, item] })
      }
      if (key === 'tags' || key === 'tag') {
        facts.push({ rel: 'Tag', row: [path, s] })
      }
    }
  }
}

const SEP = ''

function dedup(facts: Fact[]): Fact[] {
  const seen = new Set<string>()
  const out: Fact[] = []
  for (const f of facts) {
    const key = f.rel + SEP + f.row.join(SEP)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(f)
    }
  }
  return out
}
