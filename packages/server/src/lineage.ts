// Tracing a query-result column back to the fact it came from — the
// view-update problem, restricted to the cases with one answer.
//
// This used to walk the rule bodies itself: a column was writable iff its
// variable appeared at exactly one position of one positive EDB atom,
// unfolding IDBs defined by a single non-recursive rule, and resolving an edit
// meant substituting the row's values back into the traced atom and solving
// for whatever the row could not pin. Four hundred lines of it, and the
// unfolding stopped at multi-rule heads, aggregation, arithmetic and negation.
//
// flow-ts compiles the same question into Datalog now. A query already reaches
// the engine as `Q<hash>(vars) :- <body>.`, so it is a relation like any other,
// and `compileShadow` emits rules that run it backwards — `Upd_MdNodeText(...)
// :- Upd_Q(...), <the body, replayed>.` Asking which column is writable is
// reading which update rules were emitted; resolving an edit is seeding one
// and reading what comes out, verified by re-running the program forwards.
//
// What stays here is the part flow-ts cannot know. A plugin declares which
// attributes it can serialise — a task's text can be rewritten, the line it
// sits on cannot — and that is a fact about the markdown writer rather than
// about the rules. The engine names where a column lands (`writeTargets`) and
// this decides whether that is allowed.

import type { Cell, DataType, Fact } from '@flow-md/plugin-api'
import { parseProgram } from '@flow-ts/parsing'
import type { BackwardRequest, Change, RequestOptions, Resolution } from 'flow-ts'

export interface ResolvedUpdate {
  rel: string
  oldFact: Fact
  newFact: Fact
}

export function stripBody(source: string): string {
  return source.trim().replace(/\.\s*$/, '')
}

/** Parse a query body as the rhs of a throwaway rule (head needs a non-empty
 *  arg, so `0`). */
function parseBody(source: string) {
  const probe = parseProgram(
    `.printsize\n.decl Probe()\n.rule\nProbe(0) :- ${stripBody(source)}.`,
  )
  return probe.rules[0]!.rhs
}

/** Recover a query body's variables in order of first appearance. */
export function queryVars(source: string): string[] {
  const seen = new Set<string>()
  const vars: string[] = []
  for (const p of parseBody(source)) {
    if (p.kind !== 'Atom') continue
    for (const arg of p.atom.args) {
      if (arg.kind === 'Var' && !seen.has(arg.name)) {
        seen.add(arg.name)
        vars.push(arg.name)
      }
    }
  }
  return vars
}

/** How often each variable appears across the body's atoms.
 *
 *  A variable used twice is joined on, and a rewrite would have to change both
 *  positions at once. The engine simply emits no update rule for it; this is
 *  what lets the refusal say which of the two reasons it was. */
export function varOccurrences(source: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const p of parseBody(source)) {
    if (p.kind !== 'Atom') continue
    for (const arg of p.atom.args) {
      if (arg.kind === 'Var') counts.set(arg.name, (counts.get(arg.name) ?? 0) + 1)
    }
  }
  return counts
}

/** A query, and a way to run requests against it backwards.
 *
 *  Deliberately not the program and the facts. A registered query is answered
 *  by the vault's own graph, which already holds both and costs the delta; an
 *  ad-hoc one has a throwaway graph built for it. Which of those happened is
 *  not this module's business — it asks, and reads what comes back. */
export interface Traced {
  /** The query's head relation. */
  rel: string
  columns: string[]
  /** Head column indices an update rule was emitted for. */
  writable: readonly number[]
  /** Per writable column, the source positions it ultimately rewrites. */
  targets: Record<number, ReadonlyArray<{ rel: string; column: number }>>
  resolve(request: BackwardRequest, options?: RequestOptions): Resolution
}

/** Attribute names of a source relation, for the plugin policy and the
 *  messages. */
export type AttrsOf = (rel: string) => readonly string[] | undefined

/** Declared type of a source relation's column, when the schema has one. */
export type TypeOf = (rel: string, column: number) => DataType | undefined

/** A cell as the target attribute's type, or a complaint.
 *
 *  The engine validates a request against the *view's* inferred types and will
 *  refuse a mistyped row; this is one step further in, coercing what the wire
 *  delivered to what the source attribute declares. JSON has one number type
 *  and no notion of a string that looks numeric, so `42` into a text column is
 *  a value to convert rather than a request to reject. */
function coerce(value: Cell, type: DataType | undefined, what: string): Cell {
  if (type === undefined) return value
  if (type === 'string') return String(value)
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new Error(`${what} expects a number`)
  if (type === 'number' && !Number.isInteger(n)) {
    throw new Error(`${what} expects an integer`)
  }
  return n
}

function allowed(
  target: { rel: string; column: number },
  isWritable: (rel: string, attr: string) => boolean,
  attrsOf: AttrsOf,
): boolean {
  const attr = attrsOf(target.rel)?.[target.column]
  return attr !== undefined && isWritable(target.rel, attr)
}

/** Columns an edit can be written back through.
 *
 *  Two questions, and only the first is the engine's: which columns trace to a
 *  single source position, and of those, which land on an attribute some
 *  plugin will serialise. */
export function writableColumns(
  traced: Traced,
  isWritable: (rel: string, attr: string) => boolean,
  attrsOf: AttrsOf,
): string[] {
  const out: string[] = []
  for (const i of traced.writable) {
    const name = traced.columns[i]
    if (name === undefined) continue
    const lands = traced.targets[i]
    // No endpoint means the column is invertible in principle but nothing was
    // traced to a source relation — nothing for a plugin to write.
    if (!lands || lands.length === 0) continue
    if (lands.every((t) => allowed(t, isWritable, attrsOf))) out.push(name)
  }
  return out
}

/** Trace one cell edit to the source fact behind it. */
export function resolveUpdate(opts: {
  traced: Traced
  oldRow: Cell[]
  column: string
  value: Cell
  isWritable: (rel: string, attr: string) => boolean
  attrsOf: AttrsOf
  typeOf: TypeOf
  /** How often each query variable appears in the body. A column used twice is
   *  joined on, and that is a different refusal from one that traces nowhere. */
  occurrences: (column: string) => number
}): ResolvedUpdate {
  const { traced, oldRow, column, value } = opts
  const { columns, rel } = traced
  if (columns.length !== oldRow.length) {
    throw new Error(
      `row has ${oldRow.length} cells but the query has ${columns.length} columns`,
    )
  }
  const at = columns.indexOf(column)
  if (at < 0) throw new Error(`query has no column "${column}"`)

  // Policy before tracing, so "you may not write this" is not reported as
  // "this could not be traced". The engine will happily rewrite a line number;
  // whether the markdown writer can is a different question, and the more
  // useful answer.
  const lands = traced.targets[at] ?? []
  for (const t of lands) {
    if (allowed(t, opts.isWritable, opts.attrsOf)) continue
    const attr = opts.attrsOf(t.rel)?.[t.column]
    throw new Error(`${t.rel}.${attr ?? t.column} is not writable by any plugin`)
  }
  if (lands.length === 0 && opts.occurrences(column) > 1) {
    // Not "nothing traces here" — the variable is joined on, so a rewrite
    // would have to change every position at once. Worth its own message: it
    // is the one a query author can act on, by naming the columns separately.
    throw new Error(
      `column "${column}" joins several relation positions; the write would be ambiguous`,
    )
  }

  const newRow = [...oldRow]
  // Coerced to what the *source* attribute declares, not what the view infers:
  // the fact being written is the source's.
  newRow[at] = lands.length === 1
    ? coerce(value, opts.typeOf(lands[0]!.rel, lands[0]!.column), `column "${column}"`)
    : value
  const r = traced.resolve(
    { rel, row: oldRow as never, newRow: newRow as never },
    { requireUnambiguous: true, commit: false },
  )
  if (r.status !== 'ok') throw new Error(explain(r, column, rel))

  const change = single(r.changes, column)
  if (change.kind !== 'upd' || !change.newRow) {
    throw new Error(`column "${column}" does not resolve to a rewrite`)
  }
  return {
    rel: change.rel,
    oldFact: { rel: change.rel, row: change.row as Cell[] },
    newFact: { rel: change.rel, row: change.newRow as Cell[] },
  }
}

/** Trace a whole query row to the source fact it should be removed through. */
export function resolveFact(opts: {
  traced: Traced
  row: Cell[]
  /** Restrict to this relation (required when several qualify). */
  rel?: string
  accepts: (rel: string) => boolean
}): Fact {
  const { traced, row } = opts
  if (traced.columns.length !== row.length) {
    throw new Error(
      `row has ${row.length} cells but the query has ${traced.columns.length} columns`,
    )
  }
  const r = traced.resolve(
    { rel: traced.rel, row: row as never },
    { minimize: true, commit: false },
  )
  if (r.status !== 'ok') throw new Error(explain(r, null, traced.rel))

  // A delete fans out over every rule and picks one atom per rule, so several
  // candidates is the ordinary case for a view — a task is a list item holding
  // a paragraph, and both are nodes. Narrow by what the plugins will delete,
  // then by an explicit `rel` if the caller gave one.
  const usable = r.changes.filter(
    (c) => c.kind === 'del' && opts.accepts(c.rel) && (!opts.rel || c.rel === opts.rel),
  )
  if (usable.length === 0) {
    throw new Error(
      opts.rel
        ? `the query does not reach relation "${opts.rel}"`
        : 'the query reaches no relation that supports this operation',
    )
  }
  const rels = [...new Set(usable.map((c) => c.rel))]
  if (rels.length > 1) {
    throw new Error(`several atoms qualify (${rels.join(', ')}); pass "rel" to disambiguate`)
  }
  if (usable.length > 1) {
    throw new Error(
      `${usable.length} ${rels[0]} facts match this row; add the missing ` +
        'columns to the query so it names one',
    )
  }
  return { rel: usable[0]!.rel, row: usable[0]!.row as Cell[] }
}

function single(changes: readonly Change[], column: string): Change {
  if (changes.length === 1) return changes[0]!
  const rels = [...new Set(changes.map((c) => c.rel))]
  if (rels.length > 1) {
    throw new Error(
      `column "${column}" joins several relation positions; the write would be ambiguous`,
    )
  }
  throw new Error(
    `${changes.length} ${rels[0]} facts match this row; add the missing ` +
      'columns to the query so it names one',
  )
}

/** Turn a `Resolution` into the message these callers expect.
 *
 *  The engine distinguishes more cases than the HTTP surface does, and the
 *  wording matters: an edit reaching two relations is the join ambiguity,
 *  which is the one a query author can fix by naming more columns. */
function explain(r: Resolution, column: string | null, rel: string): string {
  if (r.status === 'ambiguous') {
    const rels = [...new Set(r.candidates.map((c) => c.rel))]
    if (column && rels.length > 1) {
      return `column "${column}" joins several relation positions; the write would be ambiguous`
    }
    return (
      `${r.candidates.length} ${rels.join('/')} facts match this row; add the missing ` +
      'columns to the query so it names one'
    )
  }
  if (r.status === 'unsatisfied') return r.reason
  if (r.status === 'refused' && /not derived from the current facts/.test(r.reason)) {
    // The row the client is holding is gone — a stale result it can retry,
    // rather than something it asked for wrongly.
    return 'no current fact matches this row (stale result?)'
  }
  const why = r.status === 'refused' ? r.reason : ''
  return column
    ? `column "${column}" cannot be traced to an EDB relation${why ? ` — ${why}` : ''}`
    : `no fact behind this row of ${rel} can be written${why ? ` — ${why}` : ''}`
}
