// The vault engine: owns the flow-ts session and the query registry.
//
// Two update paths, matching the v1 design:
//   • Content-only edit (facts changed, rules/queries unchanged) → apply the
//     per-file fact delta to the live session and advance(). Incremental.
//   • Rule/query edit (the program text changed) → rebuild the session from
//     scratch and replay every file's facts. (Goal 2 will make this
//     incremental too, by splicing rules into a running graph.)
//
// The program is assembled as Datalog *text* and parsed in one shot:
//   .in          the fixed EDB schema (schema.ts)
//   .printsize   one empty-attr `.decl` per distinct rule-head name not in
//                the EDB set — flow-ts infers arity from the rules
//   .rule        every ```datalog block, plus one synthetic rule per
//                ```datalog-query block: `Q<hash>(vars) :- <body>.`
// Heads must be non-empty, so a variable-less existence query becomes
// `Q<hash>(1) :- <body>.` with a single boolean-ish column.

import { parseProgram } from '@flow-ts/parsing'
import { type ProgramSession, openSession } from 'flow-ts'
import { createHash } from 'node:crypto'
import {
  type Cell,
  type Fact,
  type ParsedFile,
  parseMarkdown,
} from './markdown.js'
import { EDB_NAMES, edbSectionText } from './schema.js'

const SEP = String.fromCharCode(1)

export interface QueryResult {
  /** Stable synthetic relation name; also the HTTP id for this query. */
  id: string
  path: string
  /** 1-based line of the query block's opening fence. */
  line: number
  columns: string[]
  rows: Cell[][]
}

interface QueryEntry {
  id: string
  path: string
  line: number
  columns: string[]
  counts: Map<string, { row: Cell[]; mult: number }>
}

export interface VaultOptions {
  optLevel?: number | null
  noSharing?: boolean
}

export class Vault {
  private readonly files = new Map<string, ParsedFile>()
  private readonly options: VaultOptions
  private session: ProgramSession | null = null
  private programDirty = true
  private pending: Array<{ rel: string; row: Cell[]; diff: number }> = []
  /** Live query relations of the current session → their result accumulator. */
  private relToQuery = new Map<string, QueryEntry>()
  /** Last build error, surfaced to clients; cleared on a successful build. */
  private buildError: string | null = null

  constructor(options: VaultOptions = {}) {
    this.options = options
  }

  /** Add or replace a file. Computes the fact delta and flags a program
   *  rebuild if the file's rule/query blocks changed. */
  setFile(path: string, content: string, mtime: number): void {
    const next = parseMarkdown(path, content, mtime)
    const prev = this.files.get(path)
    this.diffFacts(prev?.facts ?? [], next.facts)
    const ruleChange = prev
      ? programChanged(prev, next)
      : next.rules.length > 0 || next.queries.length > 0
    if (ruleChange) this.programDirty = true
    this.files.set(path, next)
  }

  /** Remove a file: retract its facts and rebuild if it carried rules. */
  removeFile(path: string): void {
    const prev = this.files.get(path)
    if (!prev) return
    this.diffFacts(prev.facts, [])
    if (prev.rules.length > 0 || prev.queries.length > 0) this.programDirty = true
    this.files.delete(path)
  }

  /** Flush queued work: rebuild the session if the program changed, else
   *  apply the pending fact delta incrementally. */
  advance(): void {
    if (this.programDirty || !this.session) {
      this.rebuild()
    } else if (this.pending.length > 0) {
      for (const { rel, row, diff } of this.pending) {
        this.session.update(rel, row, diff)
      }
      this.session.advance()
    }
    this.pending = []
  }

  queries(filterPath?: string): QueryResult[] {
    const out: QueryResult[] = []
    for (const e of this.relToQuery.values()) {
      if (filterPath && e.path !== filterPath) continue
      out.push(toResult(e))
    }
    return out.sort((a, b) =>
      a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path),
    )
  }

  query(id: string): QueryResult | undefined {
    const e = this.relToQuery.get(id)
    return e ? toResult(e) : undefined
  }

  error(): string | null {
    return this.buildError
  }

  // --- internals ---------------------------------------------------------

  private diffFacts(oldFacts: readonly Fact[], newFacts: readonly Fact[]): void {
    const oldKeys = new Map<string, Fact>()
    for (const f of oldFacts) oldKeys.set(factKey(f), f)
    const newKeys = new Map<string, Fact>()
    for (const f of newFacts) newKeys.set(factKey(f), f)
    for (const [k, f] of oldKeys) {
      if (!newKeys.has(k)) this.pending.push({ rel: f.rel, row: f.row, diff: -1 })
    }
    for (const [k, f] of newKeys) {
      if (!oldKeys.has(k)) this.pending.push({ rel: f.rel, row: f.row, diff: 1 })
    }
  }

  private rebuild(): void {
    this.relToQuery = new Map()
    this.buildError = null
    try {
      const { programText, queries } = this.assemble()
      const program = parseProgram(programText)
      const session = openSession(program, this.options, (rel, row, mult) => {
        const e = this.relToQuery.get(rel)
        if (!e) return
        const cells = row as Cell[]
        const key = cells.join(SEP)
        const cur = e.counts.get(key)
        const m = (cur?.mult ?? 0) + mult
        if (m === 0) e.counts.delete(key)
        else e.counts.set(key, { row: [...cells], mult: m })
      })
      for (const e of queries) this.relToQuery.set(e.id, e)
      for (const file of this.files.values()) {
        for (const f of file.facts) session.update(f.rel, f.row, 1)
      }
      session.advance()
      this.session = session
      this.programDirty = false
    } catch (err) {
      this.session = null
      this.buildError = err instanceof Error ? err.message : String(err)
    }
  }

  /** Build the program text plus the query registry entries. */
  private assemble(): { programText: string; queries: QueryEntry[] } {
    const edbSection = edbSectionText()

    // User rules: parse the ```datalog blocks (EDB + rule program, no IDB
    // section needed for parsing) to recover their head names.
    const ruleText = [...this.files.values()].flatMap((f) => f.rules).join('\n')
    const userRules = ruleText.trim()
      ? parseProgram(`${edbSection}\n.rule\n${ruleText}`).rules
      : []
    const headNames = new Set<string>()
    for (const r of userRules) {
      if (!EDB_NAMES.has(r.head.name)) headNames.add(r.head.name)
    }

    // Synthetic query rules.
    const queries: QueryEntry[] = []
    const queryTexts: string[] = []
    for (const file of this.files.values()) {
      for (const q of file.queries) {
        const id = queryId(file.path, q.line, q.source)
        const vars = queryVars(q.source)
        const headArgs = vars.length ? vars.join(', ') : '1'
        const columns = vars.length ? vars : ['exists']
        queries.push({
          id,
          path: file.path,
          line: q.line,
          columns,
          counts: new Map(),
        })
        queryTexts.push(`${id}(${headArgs}) :- ${stripBody(q.source)}.`)
        headNames.add(id)
      }
    }

    if (headNames.size === 0) {
      // No rules and no queries: an EDB-only program (facts but nothing
      // derived). Still a valid session for future incremental updates.
      return { programText: edbSection, queries }
    }

    const idbSection = `.printsize\n${[...headNames]
      .map((n) => `.decl ${n}()`)
      .join('\n')}`
    const allRules = [ruleText, ...queryTexts].filter((t) => t.trim()).join('\n')
    const programText = `${edbSection}\n${idbSection}\n.rule\n${allRules}`
    return { programText, queries }
  }
}

// --- module-level helpers -------------------------------------------------

function factKey(f: Fact): string {
  return f.rel + SEP + f.row.join(SEP)
}

function programChanged(a: ParsedFile, b: ParsedFile): boolean {
  return (
    JSON.stringify(a.rules) !== JSON.stringify(b.rules) ||
    JSON.stringify(a.queries) !== JSON.stringify(b.queries)
  )
}

function stripBody(source: string): string {
  return source.trim().replace(/\.\s*$/, '')
}

/** Recover a query body's variables in order of first appearance, by parsing
 *  it as the body of a throwaway rule (head needs a non-empty arg, so `0`). */
function queryVars(source: string): string[] {
  const probe = parseProgram(
    `.printsize\n.decl Probe()\n.rule\nProbe(0) :- ${stripBody(source)}.`,
  )
  const seen = new Set<string>()
  const vars: string[] = []
  for (const p of probe.rules[0]!.rhs) {
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

function queryId(path: string, line: number, source: string): string {
  const h = createHash('sha1')
    .update(`${path}\n${line}\n${source}`)
    .digest('hex')
    .slice(0, 12)
  return `Q${h}`
}

function toResult(e: QueryEntry): QueryResult {
  const rows = [...e.counts.values()].filter((c) => c.mult > 0).map((c) => c.row)
  return { id: e.id, path: e.path, line: e.line, columns: e.columns, rows }
}
