// The flow-md plugin contract.
//
// A plugin owns a set of file extensions, contributes an EDB schema, and turns
// a file's content into facts plus Datalog rule/query blocks. The vault stays
// agnostic about file formats: register plugins, and the vault dispatches each
// file to the plugin whose `extensions` list claims it.
//
// Code-block langs are surfaced as metadata on the plugin (`codeBlockLangs`)
// so tooling (editors, formatters) can discover which fenced langs feed the
// engine, even though the parsing of those blocks happens inside `parse`.

export type Cell = string | number

export interface Fact {
  rel: string
  row: Cell[]
}

export type DataType = 'string' | 'number' | 'float'

export interface EdbDef {
  name: string
  attrs: Array<[name: string, type: DataType]>
}

/** A relation whose listed columns a plugin can rewrite in source files
 *  (the write-back side of the view-update path). `canDelete`/`canInsert`
 *  declare whether whole facts of this relation can be removed from /
 *  added to source text via `deleteFact`/`insertFact`.
 *
 *  Declarations are validated when the vault starts: `rel` and every name in
 *  `cols` must exist in the plugin's schema, capabilities require the
 *  matching method on the plugin, and `canInsert` requires `pathAttr` — the
 *  string attribute holding the vault-relative path of the file a new fact
 *  should be written into. A misdeclared plugin fails registration with a
 *  descriptive error rather than misbehaving at write time. */
export interface WritableRel {
  rel: string
  cols: string[]
  canDelete?: boolean
  canInsert?: boolean
  /** Which attribute locates the target file for inserts. */
  pathAttr?: string
}

export interface QueryBlock {
  /** 1-based line of the opening fence (or other source anchor), for inline
   *  rendering by editors. */
  line: number
  source: string
}

export interface ParseResult {
  facts: Fact[]
  /** Datalog rule sources extracted from the file (e.g. fenced `datalog`
   *  blocks in markdown). Collected into the program's `.rule` section. */
  rules: string[]
  /** Datalog query sources, rendered inline by editors. */
  queries: QueryBlock[]
}

/** Names of the fenced code-block languages a plugin treats as rule / query
 *  sources. Informational — the plugin's own `parse` still does the work. */
export interface CodeBlockLangs {
  rule: string
  query: string
}

export interface Plugin {
  /** Stable identifier (e.g. "markdown"). */
  name: string
  /** File extensions claimed by this plugin, with leading dot ("`.md`"). */
  extensions: string[]
  /** EDB relations this plugin contributes to the vault's schema. */
  schema: EdbDef[]
  /** Optional metadata about which fenced code-block langs feed the engine. */
  codeBlockLangs?: CodeBlockLangs
  parse(path: string, content: string, mtime: number): ParseResult
  /** Relations/columns this plugin can write back to source files. Only
   *  meaningful together with `updateFact`. */
  writable?: WritableRel[]
  /** Rewrite `content` so that `oldFact` reads as `newFact`. Both facts
   *  belong to a relation listed in `writable` and differ only in writable
   *  columns. Implementations should verify the source still matches
   *  `oldFact` and throw (with a human-readable message) when the fact can't
   *  be located unambiguously. */
  updateFact?(content: string, oldFact: Fact, newFact: Fact): string
  /** Remove the source text behind `fact` (a relation with `canDelete`).
   *  Throws when the fact can't be located unambiguously. */
  deleteFact?(content: string, fact: Fact): string
  /** Add source text deriving `fact` (a relation with `canInsert`; the
   *  target file comes from the fact's `pathAttr` column). Locator columns
   *  the caller can't know yet (e.g. `line`) are passed as 0 / ""; the real
   *  values come from the reparse after the write. */
  insertFact?(content: string, fact: Fact): string
}
