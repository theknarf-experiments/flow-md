// The flow-md *view plugin* contract.
//
// A view plugin contributes one or more React components usable in MDX notes
// (the JSX tag becomes the component) — e.g. <Kanban query="…"/>. Plugins are
// driven by Datalog queries against the vault, but they never talk to the
// server or import app internals directly: everything they need is on the
// `FlowMdHost`, reached through `useFlowMd()` (or the `useQuery`/`useFiles`
// hook wrappers). The app implements the host and provides it via
// `FlowMdHostProvider`, so a plugin's only dependency is this package.
//
// Authoring a plugin:
//
//   import { type FlowMdViewPlugin, useQuery } from '@flow-md/view-api'
//
//   function Histogram({ query, by }: { query: string; by: string }) {
//     const { columns, rows, ready, error } = useQuery(query)
//     if (error) return <p className="offline">{error}</p>
//     if (!ready) return null
//     // …render from columns/rows…
//   }
//
//   export const histogramPlugin: FlowMdViewPlugin = {
//     name: 'histogram',
//     components: { Histogram },
//   }
//
// The host environment provides the dark theme CSS variables (--accent,
// --fg-dim, --border, …) and the `.offline` / `.hint` utility classes, so a
// plugin's styles can lean on them and match the app.

import { type ComponentType, type ReactNode, createContext, useContext } from 'react'

export type Cell = string | number

/** Live result of an ad-hoc Datalog query. */
export interface QueryState {
  columns: string[]
  rows: Cell[][]
  /** Columns the server marks writable (editable through `updateCell`). */
  writable: string[]
  /** Query/network error, or null. */
  error: string | null
  /** True once a result has arrived — distinguishes "loading" from "empty". */
  ready: boolean
  /** Re-fetch now (e.g. after a write). */
  refresh: () => void
}

export interface UpdateCellArgs {
  /** The query whose result row is being edited (its lineage locates the
   *  source fact). */
  query: string
  /** The result row, as served. */
  row: Cell[]
  /** The column being changed (must be in the query's `writable` set). */
  column: string
  value: Cell
}

/** Capabilities the app exposes to view plugins. Provided by the app through
 *  `FlowMdHostProvider`; consumed via `useFlowMd()`. */
export interface FlowMdHost {
  /** Live result of `source`, polled (default ~3s; override with
   *  `intervalMs`). A hook — call it unconditionally at the top of render. */
  useQuery(source: string, opts?: { intervalMs?: number }): QueryState
  /** Vault note paths (live). A hook. */
  useFiles(): string[]
  /** Write one cell back through the server's lineage-checked update path. */
  updateCell(args: UpdateCellArgs): Promise<void>
  /** Delete a whole fact (row). Identify it by relation (`rel`, a complete
   *  row) or by the query it came from (`query`, traced through lineage). */
  deleteRow(args: { rel?: string; query?: string; row: Cell[] }): Promise<void>
  /** Insert a fact (row) into a relation — e.g. a new `Folder(path)` or an
   *  empty `File(path, mtime)`. */
  insertRow(args: { rel: string; row: Cell[] }): Promise<void>
  /** Resolve a wiki/link target to a vault path (Obsidian-style), or null. */
  resolveWiki(target: string): string | null
  /** Navigate to a note by its vault-relative path. */
  openNote(path: string): void
}

/** An MDX component. Props are whatever JSX attributes the note passes
 *  (strings), so the registry is intentionally loosely typed. */
// biome-ignore lint/suspicious/noExplicitAny: MDX passes arbitrary props
export type ViewComponent = ComponentType<any>

/** The default viewer for a file extension: receives the file's vault path
 *  and renders it (typically by querying the file's facts through the host).
 *  Registering one lets `flow-md serve`'s app show e.g. `.ics` files with a
 *  plugin-supplied view instead of raw text. */
export type FileHandler = ComponentType<{ path: string }>

/** A plugin contributes MDX components (keyed by JSX tag) and/or default
 *  viewers for file extensions (keyed by extension, with the leading dot). */
export interface FlowMdViewPlugin {
  name: string
  components?: Record<string, ViewComponent>
  fileHandlers?: Record<string, FileHandler>
}

const HostContext = createContext<FlowMdHost | null>(null)

export function FlowMdHostProvider(props: {
  host: FlowMdHost
  children: ReactNode
}) {
  return (
    <HostContext.Provider value={props.host}>
      {props.children}
    </HostContext.Provider>
  )
}

/** Access the host from inside a view component. Throws if rendered outside a
 *  provider (i.e. not within a flow-md note). */
export function useFlowMd(): FlowMdHost {
  const host = useContext(HostContext)
  if (!host) {
    throw new Error('useFlowMd must be used within a FlowMdHostProvider')
  }
  return host
}

/** Ergonomic wrapper: `const { rows } = useQuery('Task(p, s, t, l)')`. */
export function useQuery(
  source: string,
  opts?: { intervalMs?: number },
): QueryState {
  return useFlowMd().useQuery(source, opts)
}

/** Ergonomic wrapper for the live vault file list. */
export function useFiles(): string[] {
  return useFlowMd().useFiles()
}
