// The vault engine: owns the flow-ts session and the query registry.
//
// File parsing is delegated to plugins (see PluginRegistry). The vault stays
// agnostic about file formats — it only knows EDB facts and Datalog rule /
// query block sources.
//
// Two update paths, matching the v1 design:
//   • Content-only edit (facts changed, rules/queries unchanged) → apply the
//     per-file fact delta to the live session and advance(). Incremental.
//   • Rule/query edit (the program text changed) → rebuild the session from
//     scratch and replay every file's facts. (Goal 2 will make this
//     incremental too, by splicing rules into a running graph.)
//
// The program is assembled as Datalog *text* and parsed in one shot:
//   .in          the EDB schema (union of plugin schemas)
//   .printsize   one empty-attr `.decl` per distinct rule-head name not in
//                the EDB set — flow-ts infers arity from the rules
//   .rule        every rule block, plus one synthetic rule per query block:
//                `Q<hash>(vars) :- <body>.`
// Heads must be non-empty, so a variable-less existence query becomes
// `Q<hash>(1) :- <body>.` with a single boolean-ish column.

import type { Cell, Fact, ParseResult, Plugin, QueryBlock } from '@flow-md/plugin-api'
import { parseProgram } from '@flow-ts/parsing'
import { type ProgramSession, openSession } from 'flow-ts'
import { createHash } from 'node:crypto'
import { PluginRegistry } from './registry.js'
import { type SchemaView, buildSchema, edbSectionText } from './schema.js'

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

interface ParsedFile {
  path: string
  facts: Fact[]
  rules: string[]
  queries: QueryBlock[]
}

export interface VaultOptions {
  optLevel?: number | null
  noSharing?: boolean
}

export class Vault {
  private readonly files = new Map<string, ParsedFile>()
  private readonly options: VaultOptions
  private readonly registry: PluginRegistry
  private readonly schema: SchemaView
  private session: ProgramSession | null = null
  private programDirty = true
  private pending: Array<{ rel: string; row: Cell[]; diff: number }> = []
  /** Live query relations of the current session → their result accumulator. */
  private relToQuery = new Map<string, QueryEntry>()
  /** Last build error, surfaced to clients; cleared on a successful build. */
  private buildError: string | null = null

  constructor(plugins: readonly Plugin[], options: VaultOptions = {}) {
    this.registry = new PluginRegistry(plugins)
    this.schema = buildSchema(plugins)
    this.options = options
  }

  /** True if any registered plugin claims this file path. */
  accepts(path: string): boolean {
    return this.registry.pluginFor(path) !== null
  }

  /** File extensions watchers should subscribe to. */
  watchedExtensions(): string[] {
    return this.registry.extensions()
  }

  /** Add or replace a file. Computes the fact delta and flags a program
   *  rebuild if the file's rule/query blocks changed. Files whose extension
   *  isn't claimed by any plugin are silently ignored. */
  setFile(path: string, content: string, mtime: number): void {
    const plugin = this.registry.pluginFor(path)
    if (!plugin) return
    const parsed = plugin.parse(path, content, mtime)
    const next: ParsedFile = {
      path,
      facts: parsed.facts,
      rules: parsed.rules,
      queries: parsed.queries,
    }
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
      this.feedAllFacts(session)
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
    const edbSection = edbSectionText(this.schema)

    // User rules: parse the collected rule blocks (EDB + rule program, no IDB
    // section needed for parsing) to recover their head names.
    const ruleText = [...this.files.values()].flatMap((f) => f.rules).join('\n')
    const userRules = ruleText.trim()
      ? parseProgram(`${edbSection}\n.rule\n${ruleText}`).rules
      : []
    const headNames = new Set<string>()
    for (const r of userRules) {
      if (!this.schema.names.has(r.head.name)) headNames.add(r.head.name)
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

  /** Evaluate a one-off query body against the current rules and facts in a
   *  throwaway session, without disturbing the live one. Returns the result
   *  rows (the query's variables become the columns) or a build error. */
  runQuery(source: string): {
    error: string | null
    columns: string[]
    rows: Cell[][]
  } {
    try {
      const { ruleText, headNames } = this.collectUserRules()
      const vars = queryVars(source)
      const headArgs = vars.length ? vars.join(', ') : '1'
      const columns = vars.length ? vars : ['exists']
      const id = 'FlowMdAdHoc'
      headNames.add(id)
      const adHoc = `${id}(${headArgs}) :- ${stripBody(source)}.`

      const idbSection = `.printsize\n${[...headNames]
        .map((n) => `.decl ${n}()`)
        .join('\n')}`
      const allRules = [ruleText, adHoc].filter((t) => t.trim()).join('\n')
      const programText = `${edbSectionText(this.schema)}\n${idbSection}\n.rule\n${allRules}`

      const counts = new Map<string, { row: Cell[]; mult: number }>()
      const session = openSession(
        parseProgram(programText),
        this.options,
        (rel, row, mult) => {
          if (rel !== id) return
          const cells = row as Cell[]
          const key = cells.join(SEP)
          const cur = counts.get(key)
          const m = (cur?.mult ?? 0) + mult
          if (m === 0) counts.delete(key)
          else counts.set(key, { row: [...cells], mult: m })
        },
      )
      this.feedAllFacts(session)
      session.close()
      const rows = [...counts.values()]
        .filter((c) => c.mult > 0)
        .map((c) => c.row)
      return { error: null, columns, rows }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { error, columns: [], rows: [] }
    }
  }

  /** Parse all rule blocks together to recover the user's rule text and the
   *  set of IDB head names (everything not in the EDB schema). */
  private collectUserRules(): { ruleText: string; headNames: Set<string> } {
    const ruleText = [...this.files.values()].flatMap((f) => f.rules).join('\n')
    const userRules = ruleText.trim()
      ? parseProgram(`${edbSectionText(this.schema)}\n.rule\n${ruleText}`).rules
      : []
    const headNames = new Set<string>()
    for (const r of userRules) {
      if (!this.schema.names.has(r.head.name)) headNames.add(r.head.name)
    }
    return { ruleText, headNames }
  }

  private feedAllFacts(session: ProgramSession): void {
    for (const file of this.files.values()) {
      for (const f of file.facts) session.update(f.rel, f.row, 1)
    }
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

/** Re-export so consumers can avoid a direct @flow-md/plugin-api dep when
 *  they only need the value types. */
export type { Cell, Fact, QueryBlock } from '@flow-md/plugin-api'
