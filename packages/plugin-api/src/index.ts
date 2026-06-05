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
}
