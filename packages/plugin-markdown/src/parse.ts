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
//
// Every fact is emitted with its *provenance*: the byte range each cell was
// read from, and the range to remove if the fact is deleted. That's what
// makes write-back generic — see update.ts, which splices spans rather than
// pattern-matching each relation's syntax back out of the file.

import type { Cell, Fact, ParseResult } from '@flow-md/plugin-api'
import type { Code, Heading, Link, ListItem, Root, Text, Yaml } from 'mdast'
import { toString as mdToString } from 'mdast-util-to-string'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import {
  isMap,
  isScalar,
  isSeq,
  parse as parseYaml,
  parseDocument,
  stringify as stringifyYaml,
  type Node as YamlNode,
} from 'yaml'

export const RULE_LANG = 'datalog'
export const QUERY_LANG = 'datalog-query'

/** A half-open byte range into the file. */
export type Span = readonly [start: number, end: number]

/** Where a cell was read from, and how a new value is written back there.
 *
 *  The encoder lives here rather than in the writer because knowing that a
 *  checkbox is one character, or that a heading's level is a run of #s, is
 *  knowledge about the syntax — which is the parser's job. The writer only
 *  splices. */
export interface CellProv {
  span: Span
  /** Omitted means the value goes in verbatim. */
  encode?: (value: Cell) => string
}

export interface Provenance {
  /** Where each cell was read from, or null when the cell isn't a literal
   *  slice of the source (a path, an mtime, a line number). A cell with a
   *  span is a cell that can be rewritten. */
  cols: (CellProv | null)[]
  /** What to remove when the fact is deleted — usually more than any single
   *  cell: the whole list item, heading line or frontmatter entry. Null when
   *  the fact has no removable source of its own. */
  del: Span | null
}

/** Facts with their provenance, in emission order and *not* deduplicated: two
 *  identical facts from different places are two rows here, which is how
 *  update.ts detects that an edit can't be pinned to one of them. */
export interface Annotated {
  facts: Fact[]
  prov: Provenance[]
}

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)

// MDX shares the whole fact model; remark-mdx adds the JSX/expression node
// types, which the walk simply doesn't visit (their text children still are).
const mdxProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkMdx)

/** `- [x]` / `- [ ]`, from either spelling of the fact. */
const checkboxMark = (value: Cell): string =>
  value === 'closed' || value === 'true' ? 'x' : ' '

const indent = (value: Cell): string => {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 40) {
    throw new Error('indentation must be 0–40 spaces')
  }
  return ' '.repeat(n)
}

const hashes = (value: Cell): string => {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 6) {
    throw new Error('Heading level must be 1–6')
  }
  return '#'.repeat(n)
}

/** Render a new YAML scalar: plain when it round-trips to the same string (so
 *  `42` stays a number, `done` stays a word), quoted otherwise. */
export function renderScalar(value: Cell): string {
  const text = String(value)
  try {
    const round = parseYaml(text)
    if (round !== null && typeof round !== 'object' && String(round) === text) {
      return text
    }
  } catch {
    // fall through to quoting
  }
  return stringifyYaml(text).trimEnd()
}

/** `^an-id` at the end of a line, after a space. Line-level rather than
 *  inline: a block id names the block it closes, not the words beside it. */
const BLOCK_ID = /\s\^([A-Za-z0-9][\w-]*)\s*$/

/** A list item's marker, and the indentation that decides what it's under. */
const LIST_LINE = /^([ \t]*)(?:[-*+]|\d+[.)])\s/

const WIKILINK = /\[\[([^\]]+)\]\]/g
// A tag starts at a word boundary, begins with a letter, and may nest (a/b).
const TAG = /(?:^|\s)#([A-Za-z][\w/-]*)/g

export function parseMarkdown(
  path: string,
  content: string,
  mtime: number,
): ParseResult {
  return parseWith(processor, path, content, mtime).result
}

/** `.mdx` parsing: same facts, MDX syntax tolerated. Malformed JSX (which
 *  remark-mdx throws on, unlike plain markdown) degrades to a File-only
 *  result instead of poisoning the vault. */
export function parseMdx(
  path: string,
  content: string,
  mtime: number,
): ParseResult {
  try {
    return parseWith(mdxProcessor, path, content, mtime).result
  } catch {
    return { facts: [{ rel: 'File', row: [path, mtime] }], rules: [], queries: [] }
  }
}

/** The same parse, keeping provenance. Used by write-back, which needs to know
 *  where each fact came from; `.mdx` is parsed with the MDX processor so the
 *  spans line up with the file the caller is about to rewrite. */
export function parseAnnotated(path: string, content: string): Annotated {
  const proc = path.toLowerCase().endsWith('.mdx') ? mdxProcessor : processor
  return parseWith(proc, path, content, 0).annotated
}

function parseWith(
  proc: typeof processor,
  path: string,
  content: string,
  mtime: number,
): { result: ParseResult; annotated: Annotated } {
  const tree = proc.parse(content) as Root
  const facts: Fact[] = []
  const prov: Provenance[] = []
  const rules: string[] = []
  const queries: ParseResult['queries'] = []

  const emit = (rel: string, row: Cell[], p: Provenance) => {
    facts.push({ rel, row })
    prov.push(p)
  }
  /** No cell of this fact is a slice of the file. */
  const none = (n: number): Provenance => ({ cols: Array(n).fill(null), del: null })

  emit('File', [path, mtime], none(2))
  emitAst(path, tree as UNode, content, emit)

  // What's left for the walk: the two constructs a rule can't derive, plus
  // routing the fenced blocks that carry the program itself.
  walk(tree, (node) => {
    switch (node.type) {
      case 'yaml':
        emitFrontmatter(path, node as Yaml, content, emit)
        break
      case 'code': {
        const c = node as Code
        const lang = (c.lang ?? '').toLowerCase()
        if (lang === RULE_LANG) rules.push(c.value)
        else if (lang === QUERY_LANG) queries.push({ line: lineOf(node), source: c.value })
        break
      }
      case 'text': {
        const t = node as Text
        const base = spanOf(node)?.[0] ?? 0
        for (const m of t.value.matchAll(TAG)) {
          // The match includes the leading boundary; the tag itself starts
          // after the "#".
          const at = base + m.index + m[0].indexOf('#')
          emit('MdInlineTag', [path, m[1]!, lineAt(content, at)], {
            cols: [null, plain([at + 1, at + m[1]!.length + 1]), null],
            del: [at, at + m[1]!.length + 1],
          })
        }
        break
      }
    }
  })

  emitBlockIds(path, content, emit)

  return {
    result: { facts: dedup(facts), rules, queries },
    annotated: { facts, prov },
  }
}

/** Block ids, read straight from the text. Not part of the tree: mdast has
 *  no node for them, and they belong to a line rather than to a phrase. */
function emitBlockIds(
  path: string,
  content: string,
  emit: (rel: string, row: Cell[], p: Provenance) => void,
): void {
  let at = 0
  content.split('\n').forEach((text, i) => {
    const item = text.match(LIST_LINE)
    if (item) {
      emit('MdIndent', [path, i + 1, item[1]!.length], {
        // Rewriting the indent is how a list item is moved in or out — the
        // span is the whitespace itself, which is empty at the top level.
        cols: [null, null, encoded([at, at + item[1]!.length], indent)],
        del: null,
      })
    }

    const m = text.match(BLOCK_ID)
    if (m?.index !== undefined) {
      const start = at + m.index
      emit('MdBlockId', [path, m[1]!, i + 1], {
        // The id itself is rewritable; deleting takes the space before it so
        // the line doesn't end in one.
        cols: [null, plain([start + m[0].indexOf('^') + 1, start + m[0].trimEnd().length]), null],
        del: [start, start + m[0].trimEnd().length],
      })
    }
    at += text.length + 1
  })
}

interface UNode {
  type: string
  position?: {
    start?: { line?: number; offset?: number }
    end?: { offset?: number }
  }
  children?: UNode[]
}

/** Where a node property was written, for the handful of properties that are
 *  a literal slice of the source. Keyed `type.property`.
 *
 *  This is provenance, not syntax: a property without an entry is still a
 *  fact you can query, it just can't be rewritten in place — which is the
 *  truth, since nothing in the file says it. */
const PROP_SPAN: Record<string, (node: UNode, content: string) => CellProv | null> = {
  'link.url': (n, c) => plain(urlSpan(n, c)),
  'image.url': (n, c) => plain(urlSpan(n, c)),
  'definition.url': (n, c) => plain(urlSpan(n, c)),
  'code.lang': (n, c) => plain(infoSpan(n, c)),
  'heading.depth': (node) => {
    const depth = (node as { depth?: number }).depth ?? 1
    const whole = spanOf(node)
    return whole ? { span: [whole[0], whole[0] + depth], encode: hashes } : null
  },
  'listItem.checked': (n, c) => encoded(checkboxSpan(n, c), checkboxMark),
}

/** The AST itself, as relations. Every node becomes a row, every scalar
 *  property becomes a fact, and every node's rendered text is recorded with
 *  the range it came from — so a rule over this can say what a heading or a
 *  task is, instead of the parser deciding in advance.
 *
 *  Nothing here is markdown-specific beyond the node types: the property walk
 *  takes whatever mdast (or mdx) put on the node. */
function emitAst(
  path: string,
  root: UNode,
  content: string,
  emit: (rel: string, row: Cell[], p: Provenance) => void,
): void {
  let id = 0
  const visit = (node: UNode, parent: number): void => {
    const self = id++
    const whole = spanOf(node)
    emit(
      'MdNode',
      [path, self, parent, node.type, lineOf(node), whole?.[0] ?? -1, whole?.[1] ?? -1],
      { cols: [null, null, null, null, null, null, null], del: whole },
    )

    // A node's text is only rewritable when the source says it literally.
    // `**bold** task` renders as "bold task", which is not what's written, so
    // it gets no span and an edit to it is refused rather than flattening the
    // markup away — write the text node inside instead.
    const text = mdToString(node)
    const inner = node.children?.length ? childSpan(node) : whole
    const literal = inner && content.slice(inner[0], inner[1]) === text ? inner : null
    emit('MdNodeText', [path, self, text], { cols: [null, null, plain(literal)], del: whole })

    // A link is a link whether the parser knew the syntax or not. Marking
    // both kinds with one property lets a single rule define Link and
    // LinkLabel — and a view defined by one rule is a view you can write
    // through, which is what makes a tab's link editable.
    if (node.type === 'link') {
      emit('MdProp', [path, self, 'link', 'md'], {
        cols: [null, null, null, null],
        del: null,
      })
    }

    for (const [key, value] of Object.entries(node as unknown as Record<string, unknown>)) {
      if (key === 'type' || key === 'children' || key === 'position' || key === 'value') continue
      const span = PROP_SPAN[`${node.type}.${key}`]?.(node, content) ?? null
      if (typeof value === 'number') {
        emit('MdPropNum', [path, self, key, value], { cols: [null, null, null, span], del: null })
      } else if (typeof value === 'string' || typeof value === 'boolean') {
        emit('MdProp', [path, self, key, String(value)], {
          cols: [null, null, null, span],
          del: null,
        })
      }
      // Objects and arrays (MDX attributes, table alignment) are structure of
      // their own; they'd need nodes, not properties.
    }

    // A checkbox also reads as a status, in the words the Task view uses.
    // The raw `checked` boolean is above, unchanged; this is the same
    // character seen as what it means. Without it the view would need one
    // rule per state, and a column that differs by rule can't be traced back
    // to anything writable — toggling a task from a query would stop working.
    const checked = (node as { checked?: boolean | null }).checked
    if (typeof checked === 'boolean') {
      emit('MdProp', [path, self, 'status', checked ? 'closed' : 'open'], {
        cols: [null, null, null, encoded(checkboxSpan(node, content), checkboxMark)],
        del: null,
      })
    }

    // `[[wiki]]` links have no mdast node, so the tree grows one here: same
    // shape, same properties, a type of its own. Nothing downstream needs to
    // know it was scraped with a regular expression.
    if (node.type === 'text') {
      const value = String((node as { value?: string }).value ?? '')
      const base = whole?.[0] ?? 0
      for (const m of value.matchAll(WIKILINK)) {
        const inner = m[1] ?? ''
        const target = inner.split('|')[0]!.split('#')[0]!.trim()
        if (!target) continue
        // `[[Target|alias]]` — the alias is what the reader sees, so it's the
        // label; without one the target doubles as its own.
        const alias = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1).trim() : target
        const at = base + m.index
        const span: Span = [at, at + m[0].length]
        const targetAt = at + 2 + inner.indexOf(target)
        const aliasAt = inner.includes('|')
          ? at + 2 + inner.indexOf('|') + 1 + (inner.slice(inner.indexOf('|') + 1).length -
              inner.slice(inner.indexOf('|') + 1).trimStart().length)
          : targetAt
        const wiki = id++
        emit('MdNode', [path, wiki, self, 'wikiLink', lineAt(content, at), span[0], span[1]], {
          cols: [null, null, null, null, null, null, null],
          del: span,
        })
        emit('MdNodeText', [path, wiki, alias], {
          cols: [null, null, plain([aliasAt, aliasAt + alias.length])],
          del: span,
        })
        emit('MdProp', [path, wiki, 'url', target], {
          cols: [null, null, null, plain([targetAt, targetAt + target.length])],
          del: null,
        })
        emit('MdProp', [path, wiki, 'link', 'wiki'], {
          cols: [null, null, null, null],
          del: null,
        })
      }
    }

    if (node.children) for (const child of node.children) visit(child, self)
  }
  visit(root, -1)
}

function walk(node: UNode, visit: (n: UNode) => void): void {
  visit(node)
  if (node.children) for (const child of node.children) walk(child, visit)
}

function lineOf(node: UNode): number {
  return node.position?.start?.line ?? 0
}

/** 1-based line containing a byte offset. */
function lineAt(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++
  }
  return line
}

/** A cell written back exactly as it reads. */
const plain = (span: Span | null): CellProv | null => (span ? { span } : null)

const encoded = (span: Span | null, encode: (v: Cell) => string): CellProv | null =>
  span ? { span, encode } : null

function spanOf(node: UNode | undefined): Span | null {
  const start = node?.position?.start?.offset
  const end = node?.position?.end?.offset
  return typeof start === 'number' && typeof end === 'number' ? [start, end] : null
}

/** The range covering a node's children — the text of a heading, the label of
 *  a link — as opposed to the syntax around them. */
function childSpan(node: UNode | undefined): Span | null {
  const kids = node?.children
  if (!kids?.length) return null
  const first = spanOf(kids[0])
  const last = spanOf(kids[kids.length - 1])
  return first && last ? [first[0], last[1]] : null
}

/** The URL inside `[label](url)`, found by walking back from the node's end
 *  rather than re-parsing: everything after the last `](` is the destination
 *  (plus an optional title, which stays put). */
function urlSpan(node: UNode, content: string): Span | null {
  const whole = spanOf(node)
  if (!whole) return null
  const raw = content.slice(whole[0], whole[1])
  const open = raw.lastIndexOf('](')
  if (open < 0) return null
  const start = whole[0] + open + 2
  let end = whole[1] - 1
  // A title (`](url "title")`) sits between the URL and the closing paren.
  const title = content.slice(start, end).search(/\s+["'(]/)
  if (title >= 0) end = start + title
  return [start, end]
}

/** The single character between the brackets of a GFM checkbox. */
function checkboxSpan(node: UNode, content: string): Span | null {
  const whole = spanOf(node)
  if (!whole) return null
  const at = content.indexOf('[', whole[0])
  return at >= 0 && at < whole[1] ? [at + 1, at + 2] : null
}

/** The info string on a fenced code block's opening line. */
function infoSpan(node: UNode, content: string): Span | null {
  const whole = spanOf(node)
  if (!whole) return null
  const eol = content.indexOf('\n', whole[0])
  const line = content.slice(whole[0], eol < 0 ? whole[1] : eol)
  const fence = line.match(/^\s*(`{3,}|~{3,})/)
  if (!fence) return null
  const start = whole[0] + fence[0].length
  return [start, whole[0] + line.length]
}

/** Frontmatter facts come from the YAML document, so their spans come from
 *  the YAML parser's own ranges — offset by where the block starts in the
 *  file. That keeps `key: value`, list items and quoting exactly as written
 *  instead of restringifying the block on every edit. */
function emitFrontmatter(
  path: string,
  node: Yaml,
  content: string,
  emit: (rel: string, row: Cell[], p: Provenance) => void,
): void {
  const block = spanOf(node as UNode)
  if (!block) return
  // The node's span includes the `---` fences; the YAML itself is the value.
  const base = content.indexOf(node.value, block[0])
  if (base < 0) return

  let doc: ReturnType<typeof parseDocument>
  try {
    doc = parseDocument(node.value)
  } catch {
    return
  }
  if (!isMap(doc.contents)) return

  const shift = (r: YamlNode['range']): Span | null =>
    r ? [base + r[0], base + r[1]] : null
  /** The whole line an entry sits on, so deleting it doesn't leave a stub. */
  const entryLine = (r: YamlNode['range']): Span | null => {
    if (!r) return null
    const start = content.lastIndexOf('\n', base + r[0]) + 1
    const eol = content.indexOf('\n', base + r[1])
    return [start, eol < 0 ? content.length : eol + 1]
  }

  /** An item written inline in `[a, b]`, with the comma that joins it to a
   *  neighbour. Null when the item is on a line of its own. */
  const flowItem = (src: string, at: number, r: YamlNode['range']): Span | null => {
    if (!r) return null
    const start = at + r[0]
    const end = at + r[1]
    const lineStart = src.lastIndexOf('\n', start) + 1
    if (!src.slice(lineStart, start).includes('[')) return null
    const after = src.slice(end).match(/^\s*,\s*/)
    if (after) return [start, end + after[0].length]
    const before = src.slice(lineStart, start).match(/,\s*$/)
    return before ? [start - before[0].length, end] : [start, end]
  }

  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key)) continue
    const key = String(pair.key.value)
    const value = pair.value
    const items = isSeq(value) ? value.items : [value]
    for (const item of items) {
      if (!isScalar(item)) continue
      const raw = item.value
      const s = raw == null ? '' : String(raw)
      const span = shift(item.range)
      // A block list item is deleted by the line, and a lone `key: value`
      // takes its key with it. An item of a *flow* list (`tags: [a, b]`)
      // shares its line with the key and its siblings, so only the item and
      // one separator go.
      const del = isSeq(value)
        ? flowItem(content, base, item.range) ?? entryLine(item.range)
        : entryLine(pair.key.range)
      emit('Frontmatter', [path, key, s], {
        cols: [null, null, encoded(span, renderScalar)],
        del,
      })
      // Numeric values also get a typed fact so rules can compare/aggregate
      // them numerically (the string form sorts lexicographically).
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        emit('FrontmatterNumber', [path, key, raw], {
          cols: [null, null, encoded(span, renderScalar)],
          del,
        })
      }
    }
  }
}

const SEP = ''

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
