// Write-back: rewrite a markdown file so one EDB fact reads differently.
// This is the markdown plugin's half of the view-update path — the vault
// resolves a query-row edit down to (oldFact, newFact) and hands us the file
// content; we splice the change into the source text.
//
// There is deliberately no per-relation rewriting logic here. The parser
// records where every cell was read from (see parse.ts), so an update is:
// find the fact, splice the spans of the columns that changed. A delete is:
// splice the fact's removable range. Adding a relation to the writable set is
// a matter of the parser recording spans for it and an entry in SYNTAX below,
// not a new function.
//
// Only inserts need per-relation syntax, because rendering *new* source can't
// be derived from spans that don't exist yet. Those are one-line templates,
// with frontmatter the single exception: YAML has its own structure, and
// placing a key inside a block is not "a line in the body".
//
// Every write reparses the file first and requires the old fact to be
// derivable from exactly one place. A fact that appears twice is ambiguous and
// refused rather than guessed at.

import type { Cell, EdbDef, Fact, WritableRel } from '@flow-md/plugin-api'
import { parseAnnotated, renderScalar, type Provenance, type Span } from './parse.js'
import { MARKDOWN_DERIVED } from './rules.js'
import { MARKDOWN_SCHEMA } from './schema.js'

interface RelSyntax {
  /** Columns that may be rewritten, by name. A column still needs a span at
   *  write time — `# heading` has one, a heading inside a table cell may not. */
  cols: string[]
  /** Renders a new fact as a line of markdown; presence enables insert. */
  render?: (row: Cell[]) => string
  /** Custom placement, for facts that don't live in the document body. */
  insert?: (content: string, row: Cell[]) => string
  deletable?: boolean
  /** Which column holds the vault-relative path (required for insert). */
  pathAttr?: string
}

const CHECKBOX: Record<string, string> = { open: ' ', closed: 'x' }

function checkbox(status: Cell | undefined): string {
  const mark = CHECKBOX[String(status)]
  if (mark === undefined) throw new Error('Task status must be "open" or "closed"')
  return mark
}

const SYNTAX: Record<string, RelSyntax> = {
  // --- the tree ------------------------------------------------------------
  //
  // These are what the parser reads out of the file, so these are what can be
  // rewritten in place. An edit to a view — a Task's text, a Heading's level —
  // arrives here as an edit to one of these, traced through the rules by the
  // vault's lineage.
  MdNodeText: { cols: ['text'], pathAttr: 'path' },
  MdProp: { cols: ['value'], pathAttr: 'path' },
  MdPropNum: { cols: ['num'], pathAttr: 'path' },
  MdNode: {
    // Nothing about a node is rewritable in place — its type and position are
    // what the syntax *is*. It can be removed, which takes its subtree, and
    // that is how a view row is deleted: lineage traces the row back to the
    // node behind it.
    cols: [],
    deletable: true,
    pathAttr: 'path',
  },

  // --- the two parsed languages --------------------------------------------
  Frontmatter: {
    cols: ['value'],
    insert: (content, [, key, value]) => insertFrontmatter(content, String(key), String(value)),
    deletable: true,
    pathAttr: 'path',
  },
  FrontmatterNumber: {
    cols: ['num'],
    insert: (content, [, key, num]) => insertFrontmatter(content, String(key), String(num)),
    deletable: true,
    pathAttr: 'path',
  },
  MdIndent: {
    // Not deletable and not insertable: a line's indentation exists exactly
    // when the line does.
    cols: ['spaces'],
    pathAttr: 'path',
  },
  MdBlockId: {
    cols: ['id'],
    // Appended to a line rather than written on one of its own — that's what
    // makes it *that block's* id.
    insert: (content, [, id, line]) => appendBlockId(content, String(id), Number(line)),
    deletable: true,
    pathAttr: 'path',
  },
  MdInlineTag: {
    cols: ['tag'],
    render: ([, tag]) => `#${tag}`,
    deletable: true,
    pathAttr: 'path',
  },

  // --- views ---------------------------------------------------------------
  //
  // A view has no source text of its own, so it can't be rewritten or located
  // — but it can be *written*: rendering `- [ ] text` doesn't require knowing
  // where an existing one is. Deleting one goes through lineage to its node.
  Task: {
    cols: [],
    render: ([, status, text]) => `- [${checkbox(status)}] ${literal(text, 'Task text')}`,
    pathAttr: 'path',
  },
  Heading: {
    cols: [],
    render: ([, level, text]) =>
      `${'#'.repeat(clampLevel(level))} ${literal(text, 'Heading text')}`,
    pathAttr: 'path',
  },
  Link: {
    cols: [],
    render: ([, dst, kind]) => (kind === 'wiki' ? `- [[${dst}]]` : `- [${dst}](${dst})`),
    pathAttr: 'src',
  },
  LinkLabel: {
    cols: [],
    render: ([, dst, text]) => `- [${text}](${dst})`,
    pathAttr: 'src',
  },
  CodeBlock: {
    cols: [],
    render: ([, lang]) => `\`\`\`${lang}\n\`\`\``,
    pathAttr: 'path',
  },
  Tag: {
    cols: [],
    render: ([, tag]) => `#${tag}`,
    pathAttr: 'path',
  },
}

/** Column names per relation, from the schema — so `cols` above can't name a
 *  column that doesn't exist, and indices never drift from the EDB. */
const ATTRS: Record<string, string[]> = Object.fromEntries(
  [...MARKDOWN_SCHEMA, ...MARKDOWN_DERIVED].map((def: EdbDef) => [
    def.name,
    def.attrs.map(([name]) => name),
  ]),
)

/** True for relations the parser actually emits. A view can be written but
 *  never verified against a reparse — the plugin doesn't evaluate rules. */
const isFact = (rel: string): boolean => MARKDOWN_SCHEMA.some((d) => d.name === rel)

export const MARKDOWN_WRITABLE: WritableRel[] = Object.entries(SYNTAX).map(
  ([rel, syntax]) => ({
    rel,
    cols: syntax.cols,
    canDelete: syntax.deletable ?? false,
    canInsert: !!(syntax.render || syntax.insert),
    ...(syntax.pathAttr ? { pathAttr: syntax.pathAttr } : {}),
  }),
)

export function updateMarkdownFact(
  content: string,
  oldFact: Fact,
  newFact: Fact,
): string {
  if (oldFact.rel !== newFact.rel || oldFact.row.length !== newFact.row.length) {
    throw new Error('old and new fact must belong to the same relation')
  }
  const syntax = syntaxFor(oldFact.rel)
  const attrs = ATTRS[oldFact.rel] ?? []
  const prov = locate(content, oldFact)

  // Highest offset first: splicing from the end keeps the earlier spans valid.
  const edits: Array<{ span: Span; text: string }> = []
  for (let i = 0; i < oldFact.row.length; i++) {
    if (oldFact.row[i] === newFact.row[i]) continue
    const name = attrs[i] ?? `#${i}`
    if (!syntax.cols.includes(name)) {
      throw new Error(`column "${name}" of ${oldFact.rel} is not writable`)
    }
    const span = prov.cols[i]
    if (!span) {
      throw new Error(
        `${oldFact.rel}.${name} can't be located in the source here — this ` +
          'occurrence is derived rather than written literally',
      )
    }
    // How the value is written belongs to the span that holds it.
    edits.push({
      span: span.span,
      text: span.encode ? span.encode(newFact.row[i]!) : literal(newFact.row[i], name),
    })
  }
  if (edits.length === 0) return content

  let out = content
  for (const edit of edits.sort((a, b) => b.span[0] - a.span[0])) {
    out = out.slice(0, edit.span[0]) + edit.text + out.slice(edit.span[1])
  }
  return verify(content, out, newFact, 'produce')
}

/** Remove the source behind a fact: the list item, the heading line, the
 *  frontmatter entry. A line left blank by the removal goes too — otherwise
 *  deleting the only link in a paragraph leaves an empty paragraph behind. */
export function deleteMarkdownFact(content: string, fact: Fact): string {
  const syntax = syntaxFor(fact.rel)
  if (!syntax.deletable) {
    throw new Error(`relation "${fact.rel}" is not deletable by the markdown plugin`)
  }
  const prov = locate(content, fact)
  if (!prov.del) {
    throw new Error(`${fact.rel} has no removable source text here`)
  }
  const [start, end] = prov.del
  const spliced = content.slice(0, start) + content.slice(end)
  // Entries that took their own newline with them (frontmatter) are done.
  const out = content[end - 1] === '\n' ? spliced : dropBlankLineAt(spliced, start)
  return verify(content, out, fact, 'remove')
}

/** Add source deriving a fact. Locator columns the caller can't know yet
 *  (line numbers) arrive as 0, so `line` > 0 inserts before that 1-based
 *  line and 0 appends. */
export function insertMarkdownFact(content: string, fact: Fact): string {
  const syntax = syntaxFor(fact.rel)
  if (syntax.insert) return verify(content, syntax.insert(content, fact.row), fact, 'produce')
  if (!syntax.render) {
    throw new Error(`relation "${fact.rel}" is not insertable by the markdown plugin`)
  }
  const rendered = syntax.render(fact.row)
  const attrs = ATTRS[fact.rel] ?? []
  const lineIdx = attrs.indexOf('line')
  const at = lineIdx >= 0 ? Number(fact.row[lineIdx] ?? 0) : 0

  const lines = content.split('\n')
  if (at > 0) {
    if (!Number.isInteger(at) || at > lines.length + 1) {
      throw new Error(`line ${at} is out of range`)
    }
    lines.splice(at - 1, 0, rendered)
    return lines.join('\n')
  }
  // Append: before the trailing newline if the file ends with one.
  if (lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, rendered)
  else lines.push(rendered)
  return verify(content, lines.join('\n'), fact, 'produce')
}

/** Reparse the rewritten file and check it says what the edit claimed.
 *
 *  This is the generic replacement for the per-relation guards the old code
 *  carried — "heading text must not start with #", "task text must
 *  round-trip", and every other rule about what a value may contain. Rather
 *  than enumerate the ways markdown can reinterpret a value, write it and
 *  check the fact comes back. A value that changes the structure is rejected
 *  because the file no longer derives the fact that was asked for.
 *
 *  Locator columns the caller couldn't know (a line of 0 on insert) are
 *  ignored when matching. */
function verify(
  before: string,
  out: string,
  fact: Fact,
  mode: 'produce' | 'remove',
): string {
  if (!isFact(fact.rel)) return out
  const path = String(fact.row[0] ?? '')
  const attrs = ATTRS[fact.rel] ?? []
  const matches = (f: Fact): boolean =>
    f.rel === fact.rel &&
    f.row.length === fact.row.length &&
    f.row.every((cell, i) => {
      const want = fact.row[i]
      // A locator the caller couldn't know yet (a line of 0 on insert).
      if (attrs[i] === 'line' && Number(want) === 0) return true
      return String(cell) === String(want)
    })
  if (mode === 'produce' && !parseAnnotated(path, out).facts.some(matches)) {
    throw new Error(
      `the edit doesn't round-trip: ${fact.rel}(${fact.row.join(', ')}) is not ` +
        'what the file says afterwards — the value changes the markdown structure',
    )
  }
  // Deletion can't be checked by asking whether the fact is gone: ids, lines
  // and offsets are positions, and positions renumber. Removing the first of
  // two identical links leaves a row that reads exactly like the one just
  // deleted. What can be checked is that something actually went.
  if (mode === 'remove' && out.length >= before.length) {
    throw new Error(`${fact.rel}(${fact.row.join(', ')}) left the file unchanged`)
  }
  return out
}

// --- locating ---------------------------------------------------------------

function syntaxFor(rel: string): RelSyntax {
  const syntax = SYNTAX[rel]
  if (!syntax) {
    throw new Error(`relation "${rel}" is not writable by the markdown plugin`)
  }
  return syntax
}

/** Find the one place a fact was read from. Two identical facts in one file
 *  are a genuine ambiguity — rewriting either would be a guess — so this
 *  refuses rather than picking the first. */
function locate(content: string, fact: Fact): Provenance {
  const path = String(fact.row[0] ?? '')
  const { facts, prov } = parseAnnotated(path, content)
  const hits: Provenance[] = []
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i]!
    if (f.rel !== fact.rel || f.row.length !== fact.row.length) continue
    if (f.row.every((cell, j) => String(cell) === String(fact.row[j]))) hits.push(prov[i]!)
  }
  if (hits.length === 0) {
    throw new Error(`${fact.rel}(${fact.row.join(', ')}) is not in the file`)
  }
  if (hits.length > 1) {
    throw new Error(
      `${fact.rel}(${fact.row.join(', ')}) appears ${hits.length} times — ` +
        "an edit can't be pinned to one of them",
    )
  }
  return hits[0]!
}

// --- rendering --------------------------------------------------------------

function literal(value: Cell | undefined, what: string): string {
  const s = String(value ?? '')
  if (s.includes('\n') || s.includes('\r')) {
    throw new Error(`${what} cannot contain newlines`)
  }
  return s
}

function clampLevel(value: Cell | undefined): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 6) {
    throw new Error('Heading level must be 1–6')
  }
  return n
}

/** Add `key: value` to the frontmatter block, appending to the list when the
 *  key already holds one — which is what "add a pinned tab" is. Creates the
 *  block if the file has none. */
function insertFrontmatter(content: string, key: string, value: string): string {
  const scalar = renderScalar(value)
  const lines = content.split('\n')
  if (lines[0]?.trimEnd() !== '---') {
    return `---\n${key}: ${scalar}\n---\n${content}`
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---')
  if (end < 0) throw new Error('unterminated frontmatter block')

  const keyLine = lines.findIndex(
    (l, i) => i > 0 && i < end && l.startsWith(`${key}:`),
  )
  if (keyLine < 0) {
    lines.splice(end, 0, `${key}: ${scalar}`)
    return lines.join('\n')
  }

  const rest = lines[keyLine]!.slice(key.length + 1).trim()
  // `key:` followed by `- item` lines is a block list; append another item.
  if (!rest || rest === '[]') {
    let at = keyLine + 1
    while (at < end && lines[at]!.trimStart().startsWith('-')) at++
    const indent = lines[keyLine + 1]?.match(/^\s*/)?.[0] ?? '  '
    lines.splice(at, 0, `${indent}- ${scalar}`)
    if (rest === '[]') lines[keyLine] = `${key}:`
    return lines.join('\n')
  }
  // A flow list stays a flow list.
  if (rest.startsWith('[') && rest.endsWith(']')) {
    const inner = rest.slice(1, -1).trim()
    lines[keyLine] = `${key}: [${inner ? `${inner}, ` : ''}${scalar}]`
    return lines.join('\n')
  }
  // A lone scalar becomes a two-item list rather than silently replacing.
  lines[keyLine] = `${key}:`
  lines.splice(keyLine + 1, 0, `  - ${rest}`, `  - ${scalar}`)
  return lines.join('\n')
}

/** A line holding nothing but its own bullet — what's left when the only
 *  content of a list item is removed. */
const EMPTY_ITEM = /^\s*(?:[-*+]|\d+[.)])\s*$/

/** Put `^id` at the end of a line. */
function appendBlockId(content: string, id: string, line: number): string {
  const lines = content.split('\n')
  const idx = line - 1
  const target = lines[idx]
  if (!Number.isInteger(line) || target === undefined) {
    throw new Error(`line ${line} is out of range`)
  }
  if (BLOCK_ID_LINE.test(target)) {
    throw new Error(`line ${line} already has a block id`)
  }
  lines[idx] = `${target.trimEnd()} ^${id}`
  return lines.join('\n')
}

const BLOCK_ID_LINE = /\s\^[A-Za-z0-9][\w-]*\s*$/

/** Drop the line containing `at` if the deletion emptied it. */
function dropBlankLineAt(content: string, at: number): string {
  // lastIndexOf clamps a negative fromIndex to 0, which would find a newline
  // sitting at offset 0 and put the line start after it.
  const start = at === 0 ? 0 : content.lastIndexOf('\n', at - 1) + 1
  const eol = content.indexOf('\n', at)
  const end = eol < 0 ? content.length : eol
  const line = content.slice(start, end)
  if (line.trim() && !EMPTY_ITEM.test(line)) return content
  return content.slice(0, start) + content.slice(eol < 0 ? content.length : eol + 1)
}
