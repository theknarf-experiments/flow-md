// Lineage analysis: trace a query-result column back to the EDB fact it came
// from — the view-update problem, restricted to the unambiguous cases.
//
// A result column is writable iff its variable appears at exactly one
// position of one positive EDB atom reachable from the query body, and the
// owning plugin declares that (relation, attribute) pair writable. "Reachable"
// includes unfolding IDB atoms whose relation is defined by exactly one
// non-recursive rule: `Open(p, t) :- Task(p, "open", t, _).` makes columns of
// an `Open(p, t)` query writable through the underlying Task atom. Heads with
// several rules (ambiguous which branch derived a row), aggregation/arithmetic
// head args, and atoms under negation stop the trace — those columns simply
// report as read-only.
//
// Resolving an edit substitutes the row's values into the traced atom to
// reconstruct the source fact. Positions the row can't pin directly are
// solved for: an atom that already matches exactly one fact pins the
// variables it shares with the others, and that repeats until nothing new is
// learned. A `Task(path, status, text, line)` row names no node, but its line
// pins the list item, the item pins its paragraph, and the paragraph pins the
// text to rewrite. Placeholders (`_`) stay anonymous — two of them are not
// the same thing — and anything still unpinned must match exactly one fact.

import type { Cell, DataType, Fact } from '@flow-md/plugin-api'
import { parseProgram } from '@flow-ts/parsing'
import type { FLRule } from 'flow-ts'
import type { SchemaView } from './schema.js'

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

// --- atom expansion ---------------------------------------------------------

/** An atom argument after substitution into query scope: a query variable, a
 *  pinned constant, or an unknown (placeholder / projected-away rule var). */
type LArg =
  | { kind: 'Var'; name: string }
  | { kind: 'Cell'; cell: Cell }
  | { kind: 'Unknown' }

interface LAtom {
  rel: string
  args: LArg[]
}

type ParsedArg =
  | { kind: 'Var'; name: string }
  | { kind: 'Const'; value: { kind: string; value: Cell } }
  | { kind: 'Placeholder' }

function toLArg(arg: ParsedArg): LArg {
  if (arg.kind === 'Const') return { kind: 'Cell', cell: arg.value.value }
  if (arg.kind === 'Var') return { kind: 'Var', name: arg.name }
  return { kind: 'Unknown' }
}

/** All positive EDB atoms reachable from the query body, with their args
 *  rewritten into query scope. IDB atoms unfold through single-rule,
 *  non-recursive definitions; anything else is dropped from the trace. */
function expandAtoms(
  source: string,
  schema: SchemaView,
  rules: readonly FLRule[],
): LAtom[] {
  const byHead = new Map<string, FLRule[]>()
  for (const r of rules) {
    const list = byHead.get(r.head.name) ?? []
    list.push(r)
    byHead.set(r.head.name, list)
  }

  const out: LAtom[] = []
  // Rule-local variables get a name unique to the unfolding that introduced
  // them. They aren't query columns, so nothing can pin them directly — but
  // keeping them *linked* is what lets a value found for one atom pin the
  // others that share them. `Task(p, s, t, l)` unfolds to atoms joined on the
  // node id; erase the id and the text atom is left matching on text alone.
  let scope = 0
  const expand = (rel: string, args: LArg[], stack: Set<string>): void => {
    if (schema.names.has(rel)) {
      out.push({ rel, args })
      return
    }
    const defs = byHead.get(rel) ?? []
    if (defs.length !== 1 || stack.has(rel)) return
    const rule = defs[0]!
    // Only plain, distinct head variables give an invertible substitution.
    const headVars: string[] = []
    for (const ha of rule.head.headArguments) {
      if (ha.kind !== 'Var' || headVars.includes(ha.name)) return
      headVars.push(ha.name)
    }
    if (headVars.length !== args.length) return
    const subst = new Map(headVars.map((v, i) => [v, args[i]!]))
    const local = new Map<string, LArg>()
    const prefix = `${rel}#${scope++}:`
    const inScope = (a: ParsedArg): LArg => {
      if (a.kind === 'Const') return { kind: 'Cell', cell: a.value.value }
      // A placeholder is anonymous by definition: two `_`s are not the same
      // thing, so they stay unknown.
      if (a.kind !== 'Var') return { kind: 'Unknown' }
      const fromHead = subst.get(a.name)
      if (fromHead) return fromHead
      let v = local.get(a.name)
      if (!v) {
        v = { kind: 'Var', name: prefix + a.name }
        local.set(a.name, v)
      }
      return v
    }
    stack.add(rel)
    for (const p of rule.rhs) {
      if (p.kind !== 'Atom') continue
      expand(p.atom.name, (p.atom.args as ParsedArg[]).map(inScope), stack)
    }
    stack.delete(rel)
  }

  for (const p of parseBody(source)) {
    if (p.kind !== 'Atom') continue
    expand(
      p.atom.name,
      (p.atom.args as ParsedArg[]).map((a) => toLArg(a)),
      new Set(),
    )
  }
  return out
}

interface Occurrence {
  atom: LAtom
  pos: number
}

/** Every (atom, position) where each query variable lands in the expanded
 *  EDB atoms. */
function occurrences(atoms: LAtom[]): Map<string, Occurrence[]> {
  const occ = new Map<string, Occurrence[]>()
  for (const atom of atoms) {
    atom.args.forEach((arg, pos) => {
      if (arg.kind !== 'Var') return
      const list = occ.get(arg.name) ?? []
      list.push({ atom, pos })
      occ.set(arg.name, list)
    })
  }
  return occ
}

// --- public API ---------------------------------------------------------------

/** Result columns of `source` that an edit can be traced through. The flag is
 *  optimistic about unknowns: a write may still fail at resolve time if the
 *  partial row matches zero or several current facts. */
export function writableColumns(
  source: string,
  schema: SchemaView,
  isWritable: (rel: string, attr: string) => boolean,
  rules: readonly FLRule[] = [],
): string[] {
  const out: string[] = []
  for (const [name, occ] of occurrences(expandAtoms(source, schema, rules))) {
    if (occ.length !== 1) continue
    const { atom, pos } = occ[0]!
    const attr = attrAt(schema, atom, pos)
    if (attr && isWritable(atom.rel, attr[0])) out.push(name)
  }
  return out
}

function attrAt(
  schema: SchemaView,
  atom: LAtom,
  pos: number,
): [string, DataType] | undefined {
  const def = schema.defs.find((d) => d.name === atom.rel)
  if (!def || def.attrs.length !== atom.args.length) return undefined
  return def.attrs[pos]
}

export function resolveUpdate(opts: {
  source: string
  columns: string[]
  oldRow: Cell[]
  column: string
  value: Cell
  schema: SchemaView
  rules?: readonly FLRule[]
  isWritable: (rel: string, attr: string) => boolean
  /** Current facts of `rel` matching the non-null cells of `partial`. */
  findFacts: (rel: string, partial: Array<Cell | null>) => Cell[][]
}): ResolvedUpdate {
  const { source, columns, oldRow, column, value, schema } = opts
  if (columns.length !== oldRow.length) {
    throw new Error(
      `row has ${oldRow.length} cells but the query has ${columns.length} columns`,
    )
  }
  const colIdx = new Map(columns.map((c, i) => [c, i]))
  if (!colIdx.has(column)) {
    throw new Error(`query has no column "${column}"`)
  }

  const atoms = expandAtoms(source, schema, opts.rules ?? [])
  const occ = occurrences(atoms).get(column) ?? []
  if (occ.length === 0) {
    throw new Error(
      `column "${column}" cannot be traced to an EDB relation`,
    )
  }
  if (occ.length > 1) {
    throw new Error(
      `column "${column}" joins several relation positions; the write would be ambiguous`,
    )
  }
  const { atom, pos } = occ[0]!
  const attr = attrAt(schema, atom, pos)
  if (!attr) {
    throw new Error(
      `atom ${atom.rel} has ${atom.args.length} args, which doesn't match its schema`,
    )
  }
  const [attrName, attrType] = attr
  if (!opts.isWritable(atom.rel, attrName)) {
    throw new Error(`${atom.rel}.${attrName} is not writable by any plugin`)
  }

  const row = pinRow(
    atom,
    solveBindings(atoms, colIdx, oldRow, opts.findFacts),
    opts.findFacts,
  )
  const newRow = [...row]
  newRow[pos] = coerce(value, attrType, `${atom.rel}.${attrName}`)
  return {
    rel: atom.rel,
    oldFact: { rel: atom.rel, row },
    newFact: { rel: atom.rel, row: newRow },
  }
}

/** What the row itself says, plus everything that follows from it.
 *
 *  Seeded with the query's own columns, then grown: any atom that already
 *  matches exactly one fact pins the variables it shares with the others.
 *  Repeat until nothing new is learned. This is what makes a view writable —
 *  the row of a `Task(path, status, text, line)` query names no node id, but
 *  the line pins the list item, the item pins its paragraph, and the
 *  paragraph pins the text that has to be rewritten. */
function solveBindings(
  atoms: LAtom[],
  colIdx: Map<string, number>,
  oldRow: Cell[],
  findFacts: (rel: string, partial: Array<Cell | null>) => Cell[][],
): Map<string, Cell> {
  const bound = new Map<string, Cell>()
  for (const [name, i] of colIdx) {
    const cell = oldRow[i]
    if (cell !== undefined) bound.set(name, cell)
  }

  // What each unbound variable could still be. An atom narrows its variables
  // to the values its matching facts actually contain, and a variable shared
  // with another atom is narrowed by both: the text of a task matches a
  // paragraph *and* the text node inside it, but only one of them is a
  // paragraph, so the pair pins it. One candidate left means it's known.
  const candidates = new Map<string, Set<Cell>>()
  const narrow = (name: string, values: Set<Cell>): boolean => {
    const prior = candidates.get(name)
    const next = prior ? new Set([...values].filter((v) => prior.has(v))) : values
    candidates.set(name, next)
    const only = next.size === 1 ? [...next][0] : undefined
    if (only === undefined || bound.has(name)) return false
    bound.set(name, only)
    return true
  }

  for (let pass = 0; pass < atoms.length + 1; pass++) {
    let learned = false
    for (const atom of atoms) {
      const partial = partialRow(atom, bound)
      const matches = findFacts(atom.rel, partial)
      // Every atom of the body has to still hold. One that matches nothing
      // means the row is describing a file that has moved on — and without
      // this check a row could name a line that no longer exists and still
      // resolve, through the atoms that happen to match.
      if (matches.length === 0) {
        throw new Error(`no current ${atom.rel} fact matches this row (stale result?)`)
      }
      if (partial.every((c) => c !== null)) continue
      const seen = new Map<string, Set<Cell>>()
      for (const row of matches) {
        atom.args.forEach((arg, i) => {
          const cell = row[i]
          if (arg.kind !== 'Var' || bound.has(arg.name) || cell === undefined) return
          const set = seen.get(arg.name) ?? new Set<Cell>()
          set.add(cell)
          seen.set(arg.name, set)
        })
      }
      for (const [name, values] of seen) {
        if (narrow(name, values)) learned = true
      }
    }
    if (!learned) break
  }
  return bound
}

function partialRow(atom: LAtom, bound: Map<string, Cell>): Array<Cell | null> {
  return atom.args.map((arg) => {
    if (arg.kind === 'Cell') return arg.cell
    if (arg.kind === 'Var') return bound.get(arg.name) ?? null
    return null
  })
}

/** Reconstruct the full source row of `atom`: bound variables and constants
 *  pin cells; anything left is recovered from the current facts and must
 *  match exactly one. */
function pinRow(
  atom: LAtom,
  bound: Map<string, Cell>,
  findFacts: (rel: string, partial: Array<Cell | null>) => Cell[][],
): Cell[] {
  const partial = partialRow(atom, bound)
  if (partial.every((c) => c !== null)) return partial as Cell[]

  const matches = findFacts(atom.rel, partial)
  if (matches.length === 0) {
    throw new Error(`no current ${atom.rel} fact matches this row (stale result?)`)
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} ${atom.rel} facts match this row; add the missing ` +
        'columns to the query to disambiguate',
    )
  }
  return matches[0]!
}

/** Reconstruct the unique source fact a result row traces to in a relation
 *  satisfying `accepts` — the delete-path analogue of resolveUpdate. The
 *  query must reach exactly one such atom. */
export function resolveFact(opts: {
  source: string
  columns: string[]
  row: Cell[]
  /** Restrict to this relation (required when several qualify). */
  rel?: string
  schema: SchemaView
  rules?: readonly FLRule[]
  accepts: (rel: string) => boolean
  findFacts: (rel: string, partial: Array<Cell | null>) => Cell[][]
}): Fact {
  const { source, columns, row, schema } = opts
  if (columns.length !== row.length) {
    throw new Error(
      `row has ${row.length} cells but the query has ${columns.length} columns`,
    )
  }
  // Bindings come from the whole body; the filter only chooses which atom is
  // the target. A delete on a view row is pinned by the atoms around it just
  // as an update is.
  const all = expandAtoms(source, schema, opts.rules ?? [])
  const atoms = all.filter(
    (a) => opts.accepts(a.rel) && (!opts.rel || a.rel === opts.rel),
  )
  if (atoms.length === 0) {
    throw new Error(
      opts.rel
        ? `the query does not reach relation "${opts.rel}"`
        : 'the query reaches no relation that supports this operation',
    )
  }
  const rels = [...new Set(atoms.map((a) => a.rel))]
  if (rels.length > 1) {
    throw new Error(`several atoms qualify (${rels.join(', ')}); pass "rel" to disambiguate`)
  }
  // Several atoms of the *same* relation is the ordinary case for a view: a
  // task is a list item that contains a paragraph, and both are nodes. Body
  // order decides — the subject of a rule is what it starts from, so removing
  // a task removes the item rather than the paragraph inside it.
  const atom = atoms[0]!
  const colIdx = new Map(columns.map((c, i) => [c, i]))
  const cells = pinRow(
    atom,
    solveBindings(all, colIdx, row, opts.findFacts),
    opts.findFacts,
  )
  return { rel: atom.rel, row: cells }
}

function coerce(value: Cell, type: DataType, what: string): Cell {
  if (type === 'string') return String(value)
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new Error(`${what} expects a number`)
  if (type === 'number' && !Number.isInteger(n)) {
    throw new Error(`${what} expects an integer`)
  }
  return n
}
