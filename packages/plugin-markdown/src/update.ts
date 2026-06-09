// Write-back: rewrite a markdown file so one EDB fact reads differently.
// This is the markdown plugin's half of the view-update path — the vault
// resolves a query-row edit down to (oldFact, newFact) and hands us the file
// content; we splice the change into the source text.
//
// Writable columns and their strategies:
//   Task.status        toggle the GFM checkbox char on the fact's line
//   Task.text          replace the line's tail — only when the raw tail
//                      equals the fact text (formatted or multi-line task
//                      text differs from its mdToString form, so those stay
//                      read-only rather than risk mangling markup)
//   Heading.text       same raw-equality rule, on the ATX heading line
//   Frontmatter.value  rewrite a single-line scalar `key: value` entry;
//                      lists, maps and block scalars are read-only
//
// Every handler structurally verifies the target line still matches the old
// fact and throws a human-readable error otherwise. The caller (the vault)
// additionally reparses the content to confirm the old fact is derivable, so
// these checks are belt-and-braces against stale rows.

import type { Cell, Fact, WritableRel } from '@flow-md/plugin-api'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export const MARKDOWN_WRITABLE: WritableRel[] = [
  {
    rel: 'Task',
    cols: ['status', 'text'],
    canDelete: true,
    canInsert: true,
    pathAttr: 'path',
  },
  { rel: 'Heading', cols: ['text'] },
  { rel: 'Frontmatter', cols: ['value'] },
]

export function updateMarkdownFact(
  content: string,
  oldFact: Fact,
  newFact: Fact,
): string {
  if (oldFact.rel !== newFact.rel || oldFact.row.length !== newFact.row.length) {
    throw new Error('old and new fact must belong to the same relation')
  }
  switch (oldFact.rel) {
    case 'Task':
      return updateTask(content, oldFact.row, newFact.row)
    case 'Heading':
      return updateHeading(content, oldFact.row, newFact.row)
    case 'Frontmatter':
      return updateFrontmatter(content, oldFact.row, newFact.row)
    default:
      throw new Error(
        `relation "${oldFact.rel}" is not writable by the markdown plugin`,
      )
  }
}

// --- Task -------------------------------------------------------------------

// `- [ ] text` / `1. [x] text`, capturing prefix, checkbox char, separator,
// tail and optional CR so a rewrite preserves everything else byte-for-byte.
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*?)(\r?)$/

function updateTask(content: string, oldRow: Cell[], newRow: Cell[]): string {
  const diffs = changedColumns(oldRow, newRow, ['path', 'status', 'text', 'line'])
  assertOnly(diffs, ['status', 'text'], 'Task')
  const [, oldStatus, oldText, line] = oldRow

  const { lines, idx, cur } = lineAt(content, line)
  const m = cur.match(TASK_LINE)
  if (!m) throw new Error(`line ${line} is not a task-list item`)
  const curStatus = m[2] === ' ' ? 'open' : 'closed'
  if (curStatus !== oldStatus) {
    throw new Error(`task on line ${line} is "${curStatus}", not "${oldStatus}"`)
  }

  let mark = m[2]!
  let tail = m[4]!
  if (diffs.includes('status')) {
    const next = newRow[1]
    if (next !== 'open' && next !== 'closed') {
      throw new Error('Task status must be "open" or "closed"')
    }
    mark = next === 'open' ? ' ' : 'x'
  }
  if (diffs.includes('text')) {
    if (tail.trim() !== String(oldText)) {
      throw new Error(
        `task text on line ${line} does not round-trip (formatted or ` +
          'multi-line task text is read-only)',
      )
    }
    tail = singleLine(newRow[2], 'Task text')
  }
  lines[idx] = m[1]! + mark + m[3]! + tail + m[5]!
  return lines.join('\n')
}

/** Delete a Task: drop the fact's line after verifying it's the right task.
 *  Nested sub-items (more-indented task lines directly below) go with it —
 *  leaving them behind would silently reparent them. */
export function deleteMarkdownFact(content: string, fact: Fact): string {
  if (fact.rel !== 'Task') {
    throw new Error(`relation "${fact.rel}" is not deletable by the markdown plugin`)
  }
  const [, status, , line] = fact.row
  const { lines, idx, cur } = lineAt(content, line)
  const m = cur.match(TASK_LINE)
  if (!m) throw new Error(`line ${line} is not a task-list item`)
  const curStatus = m[2] === ' ' ? 'open' : 'closed'
  if (curStatus !== status) {
    throw new Error(`task on line ${line} is "${curStatus}", not "${status}"`)
  }
  const indent = indentOf(cur)
  let end = idx + 1
  while (end < lines.length && lines[end]!.trim() && indentOf(lines[end]!) > indent) {
    end++
  }
  lines.splice(idx, end - idx)
  return lines.join('\n')
}

/** Insert a Task. `line` > 0 inserts before that 1-based line; `line` 0
 *  appends at the end of the file. */
export function insertMarkdownFact(content: string, fact: Fact): string {
  if (fact.rel !== 'Task') {
    throw new Error(`relation "${fact.rel}" is not insertable by the markdown plugin`)
  }
  const [, status, text, line] = fact.row
  if (status !== 'open' && status !== 'closed') {
    throw new Error('Task status must be "open" or "closed"')
  }
  const item = `- [${status === 'open' ? ' ' : 'x'}] ${singleLine(text, 'Task text')}`
  const lines = content.split('\n')
  const at = Number(line ?? 0)
  if (at > 0) {
    if (!Number.isInteger(at) || at > lines.length + 1) {
      throw new Error(`line ${line} is out of range`)
    }
    lines.splice(at - 1, 0, item)
    return lines.join('\n')
  }
  // Append: before the trailing newline if the file ends with one.
  if (lines[lines.length - 1] === '') {
    lines.splice(lines.length - 1, 0, item)
  } else {
    lines.push(item)
  }
  return lines.join('\n')
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

// --- Heading ----------------------------------------------------------------

const HEADING_LINE = /^(#{1,6})(\s+)(.*?)(\s*)(\r?)$/

function updateHeading(content: string, oldRow: Cell[], newRow: Cell[]): string {
  const diffs = changedColumns(oldRow, newRow, ['path', 'level', 'text', 'line'])
  assertOnly(diffs, ['text'], 'Heading')
  const [, level, oldText, line] = oldRow

  const { lines, idx, cur } = lineAt(content, line)
  const m = cur.match(HEADING_LINE)
  if (!m || m[1]!.length !== level) {
    throw new Error(`line ${line} is not a level-${level} ATX heading`)
  }
  if (m[3] !== String(oldText)) {
    throw new Error(
      `heading text on line ${line} does not round-trip (formatted headings ` +
        'are read-only)',
    )
  }
  const text = singleLine(newRow[2], 'Heading text')
  if (!text.trim() || text.trimStart().startsWith('#')) {
    throw new Error('Heading text must be non-empty and not start with "#"')
  }
  lines[idx] = m[1]! + m[2]! + text + m[4]! + m[5]!
  return lines.join('\n')
}

// --- Frontmatter ------------------------------------------------------------

function updateFrontmatter(
  content: string,
  oldRow: Cell[],
  newRow: Cell[],
): string {
  const diffs = changedColumns(oldRow, newRow, ['path', 'key', 'value'])
  assertOnly(diffs, ['value'], 'Frontmatter')
  const [, key, oldValue] = oldRow

  const lines = content.split('\n')
  if (lines[0]?.trimEnd() !== '---') {
    throw new Error('file has no frontmatter block')
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---')
  if (end < 0) throw new Error('unterminated frontmatter block')

  const re = new RegExp(`^(${escapeRegExp(String(key))}:[ \\t]*)(.*?)(\\r?)$`)
  for (let i = 1; i < end; i++) {
    const m = lines[i]!.match(re)
    if (!m) continue
    const parsed = parseScalar(m[2]!)
    if (parsed.kind !== 'scalar') {
      throw new Error(
        `frontmatter "${key}" is not a single-line scalar (lists, maps and ` +
          'block values are read-only)',
      )
    }
    if (parsed.text !== String(oldValue)) {
      throw new Error(
        `frontmatter "${key}" is "${parsed.text}", not "${oldValue}"`,
      )
    }
    const value = singleLine(newRow[2], 'Frontmatter value')
    lines[i] = m[1]! + renderScalar(value) + m[3]!
    return lines.join('\n')
  }
  throw new Error(`frontmatter has no single-line "${key}" entry`)
}

/** Parse one YAML flow value; classify whether it's a plain scalar. The
 *  scalar's fact form is String(value) — matching emitFrontmatter. */
function parseScalar(
  src: string,
): { kind: 'scalar'; text: string } | { kind: 'other' } {
  if (!src.trim()) return { kind: 'other' }
  let v: unknown
  try {
    v = parseYaml(src)
  } catch {
    return { kind: 'other' }
  }
  if (v !== null && typeof v === 'object') return { kind: 'other' }
  return { kind: 'scalar', text: v == null ? '' : String(v) }
}

/** Render a new scalar value: plain when it YAML-round-trips to the same
 *  string (so `42` stays a number, `done` stays a word), quoted otherwise. */
function renderScalar(value: string): string {
  try {
    const round = parseYaml(value)
    if (round !== null && typeof round !== 'object' && String(round) === value) {
      return value
    }
  } catch {
    // fall through to quoting
  }
  return stringifyYaml(value).trimEnd()
}

// --- shared helpers ---------------------------------------------------------

function changedColumns(
  oldRow: Cell[],
  newRow: Cell[],
  names: string[],
): string[] {
  const out: string[] = []
  for (let i = 0; i < names.length; i++) {
    if (oldRow[i] !== newRow[i]) out.push(names[i]!)
  }
  return out
}

function assertOnly(diffs: string[], allowed: string[], rel: string): void {
  for (const d of diffs) {
    if (!allowed.includes(d)) {
      throw new Error(`column "${d}" of ${rel} is not writable`)
    }
  }
}

function lineAt(
  content: string,
  line: Cell | undefined,
): { lines: string[]; idx: number; cur: string } {
  const lines = content.split('\n')
  const idx = Number(line) - 1
  const cur = lines[idx]
  if (!Number.isInteger(idx) || idx < 0 || cur === undefined) {
    throw new Error(`line ${line} is out of range`)
  }
  return { lines, idx, cur }
}

function singleLine(value: Cell | undefined, what: string): string {
  const s = String(value ?? '')
  if (s.includes('\n') || s.includes('\r')) {
    throw new Error(`${what} cannot contain newlines`)
  }
  return s
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
