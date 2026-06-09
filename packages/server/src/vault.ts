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
import {
  type ResolvedUpdate,
  queryVars,
  resolveFact,
  resolveUpdate,
  stripBody,
  writableColumns,
} from './lineage.js'
import { PluginRegistry } from './registry.js'
import { type SchemaView, buildSchema, edbSectionText } from './schema.js'

const SEP = String.fromCharCode(1)

export interface QueryResult {
  /** Stable synthetic relation name; also the HTTP id for this query. */
  id: string
  path: string
  /** 1-based line of the query block's opening fence. */
  line: number
  /** The query body as written, so clients can resolve updates against it. */
  source: string
  columns: string[]
  /** Columns an edit can be written back through (see lineage.ts). */
  writable: string[]
  rows: Cell[][]
}

interface QueryEntry {
  id: string
  path: string
  line: number
  source: string
  columns: string[]
  writable: string[]
  counts: Map<string, { row: Cell[]; mult: number }>
}

interface ParsedFile {
  path: string
  /** Raw source text, kept so bulk readers (GET /contents) need no disk IO
   *  and always see exactly what the session was built from. */
  content: string
  mtime: number
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
  /** rel → writable attr names, from plugins that implement updateFact. */
  private readonly writableAttrs = new Map<string, Set<string>>()
  /** Relations whose facts can be deleted from / inserted into source. For
   *  inserts, the value is the index of the declared path attribute. */
  private readonly deletable = new Set<string>()
  private readonly insertable = new Map<string, number>()
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
    for (const p of plugins) {
      for (const w of p.writable ?? []) this.registerWritable(p, w)
    }
  }

  /** Validate one `writable` declaration against the plugin's schema and
   *  methods, then index its capabilities. Failing fast here turns a
   *  misdeclared plugin into a startup error instead of a silent no-op (or a
   *  write into the wrong place) later. */
  private registerWritable(
    p: Plugin,
    w: NonNullable<Plugin['writable']>[number],
  ): void {
    const bad = (msg: string): never => {
      throw new Error(`plugin "${p.name}": ${msg}`)
    }
    const def = p.schema.find((d) => d.name === w.rel)
    if (!def) {
      bad(`writable relation "${w.rel}" is not in the plugin's schema`)
      return
    }
    const attrNames = def.attrs.map(([n]) => n)
    for (const c of w.cols) {
      if (!attrNames.includes(c)) {
        bad(`writable column "${w.rel}.${c}" is not in the relation's schema`)
      }
    }
    if (w.cols.length > 0) {
      if (!p.updateFact) bad(`"${w.rel}" declares writable columns but no updateFact`)
      const set = this.writableAttrs.get(w.rel) ?? new Set()
      for (const c of w.cols) set.add(c)
      this.writableAttrs.set(w.rel, set)
    }
    if (w.canDelete) {
      if (!p.deleteFact) bad(`"${w.rel}" declares canDelete but no deleteFact`)
      this.deletable.add(w.rel)
    }
    if (w.canInsert) {
      if (!p.insertFact) bad(`"${w.rel}" declares canInsert but no insertFact`)
      if (!w.pathAttr) bad(`"${w.rel}" declares canInsert but no pathAttr`)
      const idx = attrNames.indexOf(w.pathAttr!)
      if (idx < 0) {
        bad(`pathAttr "${w.rel}.${w.pathAttr}" is not in the relation's schema`)
      }
      if (def.attrs[idx]![1] !== 'string') {
        bad(`pathAttr "${w.rel}.${w.pathAttr}" must be a string attribute`)
      }
      const prev = this.insertable.get(w.rel)
      if (prev !== undefined && prev !== idx) {
        bad(`"${w.rel}" is declared insertable with conflicting path attributes`)
      }
      this.insertable.set(w.rel, idx)
    }
  }

  private readonly isWritable = (rel: string, attr: string): boolean =>
    this.writableAttrs.get(rel)?.has(attr) ?? false

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
      content,
      mtime,
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

  /** Vault-relative paths of every indexed file, sorted. */
  paths(): string[] {
    return [...this.files.keys()].sort()
  }

  /** Raw content of every indexed file — the bulk sync endpoint's payload,
   *  so client stores can mirror the whole vault in one request. */
  contents(): Array<{ path: string; content: string; mtime: number }> {
    return this.paths().map((p) => {
      const f = this.files.get(p)!
      return { path: f.path, content: f.content, mtime: f.mtime }
    })
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
          source: q.source,
          columns,
          writable: writableColumns(q.source, this.schema, this.isWritable, userRules),
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
    writable: string[]
    rows: Cell[][]
  } {
    try {
      const { ruleText, headNames, rules } = this.collectUserRules()
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
      return {
        error: null,
        columns,
        writable: writableColumns(source, this.schema, this.isWritable, rules),
        rows,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { error, columns: [], writable: [], rows: [] }
    }
  }

  /** Trace an edit of one cell of a query result back to the source fact it
   *  came from, plus the vault-relative file that owns it. Throws with a
   *  human-readable message when the edit can't be resolved unambiguously. */
  resolveUpdate(
    source: string,
    oldRow: Cell[],
    column: string,
    value: Cell,
  ): ResolvedUpdate & { path: string } {
    const resolved = resolveUpdate({
      source,
      columns: queryVars(source),
      oldRow,
      column,
      value,
      schema: this.schema,
      rules: this.collectUserRules().rules,
      isWritable: this.isWritable,
      findFacts: this.findFacts,
    })
    return { ...resolved, path: this.ownerOf(resolved.oldFact) }
  }

  /** Resolve a delete request to the owning file plus the complete fact.
   *  Accepts either a complete fact (`rel` + full row) or a query-result row
   *  (`source` + row, traced through lineage like an update). */
  resolveDelete(input: {
    rel?: string
    source?: string
    row: Cell[]
  }): { path: string; fact: Fact } {
    let fact: Fact
    if (input.source) {
      fact = resolveFact({
        source: input.source,
        columns: queryVars(input.source),
        row: input.row,
        ...(input.rel !== undefined ? { rel: input.rel } : {}),
        schema: this.schema,
        rules: this.collectUserRules().rules,
        accepts: (rel) => this.deletable.has(rel),
        findFacts: this.findFacts,
      })
    } else {
      if (!input.rel) throw new Error('delete needs a relation (rel) or a query (q/id)')
      const def = this.schema.defs.find((d) => d.name === input.rel)
      if (!def) throw new Error(`unknown relation "${input.rel}"`)
      if (def.attrs.length !== input.row.length) {
        throw new Error(
          `${input.rel} has ${def.attrs.length} columns, row has ${input.row.length}`,
        )
      }
      fact = { rel: input.rel, row: input.row }
    }
    if (!this.deletable.has(fact.rel)) {
      throw new Error(`facts of ${fact.rel} cannot be deleted by any plugin`)
    }
    return { path: this.ownerOf(fact), fact }
  }

  /** Validate an insert request and locate the target file via the
   *  relation's declared path attribute; locator columns the client can't
   *  know (e.g. `line`) are 0 / "". */
  resolveInsert(rel: string, row: Cell[]): { path: string; fact: Fact } {
    const pathIdx = this.insertable.get(rel)
    if (pathIdx === undefined) {
      throw new Error(`facts of ${rel} cannot be inserted by any plugin`)
    }
    const def = this.schema.defs.find((d) => d.name === rel)!
    if (def.attrs.length !== row.length) {
      throw new Error(
        `${rel} has ${def.attrs.length} columns, row has ${row.length}`,
      )
    }
    const path = row[pathIdx]
    if (typeof path !== 'string' || !path) {
      throw new Error(
        `${rel}.${def.attrs[pathIdx]![0]} must name the target file`,
      )
    }
    if (!this.files.has(path)) {
      throw new Error(`no file "${path}" in the vault`)
    }
    return { path, fact: { rel, row } }
  }

  /** Apply a resolved update to a file's current content: re-verify the old
   *  fact is still derivable from `content` (the concurrency check), then let
   *  the owning plugin splice in the change. Returns the new content. */
  applyFactUpdate(
    path: string,
    content: string,
    oldFact: Fact,
    newFact: Fact,
  ): string {
    const plugin = this.registry.pluginFor(path)
    if (!plugin?.updateFact) {
      throw new Error(`no plugin can write back to "${path}"`)
    }
    const key = factKey(oldFact)
    const current = plugin.parse(path, content, 0).facts
    if (!current.some((f) => factKey(f) === key)) {
      throw new Error(
        'the file changed and no longer contains the fact being updated',
      )
    }
    return plugin.updateFact(content, oldFact, newFact)
  }

  /** Delete-path analogue of applyFactUpdate: verify, then splice out. */
  applyFactDelete(path: string, content: string, fact: Fact): string {
    const plugin = this.registry.pluginFor(path)
    if (!plugin?.deleteFact) {
      throw new Error(`no plugin can delete facts from "${path}"`)
    }
    const key = factKey(fact)
    const current = plugin.parse(path, content, 0).facts
    if (!current.some((f) => factKey(f) === key)) {
      throw new Error(
        'the file changed and no longer contains the fact being deleted',
      )
    }
    return plugin.deleteFact(content, fact)
  }

  /** Insert-path analogue. No staleness check: the fact doesn't exist yet. */
  applyFactInsert(path: string, content: string, fact: Fact): string {
    const plugin = this.registry.pluginFor(path)
    if (!plugin?.insertFact) {
      throw new Error(`no plugin can insert facts into "${path}"`)
    }
    return plugin.insertFact(content, fact)
  }

  /** Current facts of `rel` matching the non-null cells of `partial`. */
  private readonly findFacts = (
    rel: string,
    partial: Array<Cell | null>,
  ): Cell[][] => {
    const out: Cell[][] = []
    for (const file of this.files.values()) {
      for (const f of file.facts) {
        if (f.rel !== rel) continue
        if (partial.every((c, i) => c === null || f.row[i] === c)) {
          out.push(f.row)
        }
      }
    }
    return out
  }

  /** The single file whose facts contain `fact`. */
  private ownerOf(fact: Fact): string {
    const key = factKey(fact)
    const owners: string[] = []
    for (const file of this.files.values()) {
      if (file.facts.some((f) => factKey(f) === key)) owners.push(file.path)
    }
    if (owners.length === 0) {
      throw new Error('the source fact is no longer in the vault (stale result?)')
    }
    if (owners.length > 1) {
      throw new Error(`several files carry this fact: ${owners.join(', ')}`)
    }
    return owners[0]!
  }

  /** Parse all rule blocks together to recover the user's rule text, the
   *  parsed rules (for lineage), and the set of IDB head names (everything
   *  not in the EDB schema). */
  private collectUserRules(): {
    ruleText: string
    headNames: Set<string>
    rules: ReturnType<typeof parseProgram>['rules']
  } {
    const ruleText = [...this.files.values()].flatMap((f) => f.rules).join('\n')
    const rules = ruleText.trim()
      ? parseProgram(`${edbSectionText(this.schema)}\n.rule\n${ruleText}`).rules
      : []
    const headNames = new Set<string>()
    for (const r of rules) {
      if (!this.schema.names.has(r.head.name)) headNames.add(r.head.name)
    }
    return { ruleText, headNames, rules }
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

function queryId(path: string, line: number, source: string): string {
  const h = createHash('sha1')
    .update(`${path}\n${line}\n${source}`)
    .digest('hex')
    .slice(0, 12)
  return `Q${h}`
}

function toResult(e: QueryEntry): QueryResult {
  const rows = [...e.counts.values()].filter((c) => c.mult > 0).map((c) => c.row)
  return {
    id: e.id,
    path: e.path,
    line: e.line,
    source: e.source,
    columns: e.columns,
    writable: e.writable,
    rows,
  }
}

/** Re-export so consumers can avoid a direct @flow-md/plugin-api dep when
 *  they only need the value types. */
export type { Cell, Fact, QueryBlock } from '@flow-md/plugin-api'
