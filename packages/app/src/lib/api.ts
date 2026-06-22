// Typed client for the flow-md server's HTTP API. The app is a pure client:
// all vault state (parsing, the Datalog session, file watching) lives in the
// `flow-md serve` process; this module is the only place that talks to it.

export type Cell = string | number

export interface QueryResult {
  id: string
  path: string
  line: number
  source: string
  columns: string[]
  writable: string[]
  rows: Cell[][]
}

export interface RunResult {
  error: string | null
  columns: string[]
  writable: string[]
  rows: Cell[][]
}

const BASE =
  (import.meta.env.VITE_FLOWMD_SERVER as string | undefined) ??
  'http://localhost:4747'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  const body = (await res.json()) as T & { error?: string | null }
  if (!res.ok) {
    throw new Error(body.error ?? `${res.status} from flow-md server`)
  }
  return body
}

const post = (path: string, payload: unknown): Promise<unknown> =>
  call(path, { method: 'POST', body: JSON.stringify(payload) })

export const api = {
  base: BASE,

  health: () => call<{ ok: boolean; error: string | null }>('/health'),

  /** Bulk content sync — the whole vault in one request. */
  contents: async () =>
    (
      await call<{
        files: Array<{ path: string; content: string; mtime: number }>
      }>('/contents')
    ).files,

  /** Every registered query block's live result, across all files. */
  allQueries: async () =>
    (await call<{ error: string | null; queries: QueryResult[] }>('/queries'))
      .queries,

  file: (path: string) =>
    call<{ path: string; content: string }>(
      `/file?path=${encodeURIComponent(path)}`,
    ),

  saveFile: (path: string, content: string) =>
    call<{ error: string | null; path: string }>('/file', {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),

  queriesFor: async (file: string) =>
    await call<{ error: string | null; queries: QueryResult[] }>(
      `/queries?file=${encodeURIComponent(file)}`,
    ),

  run: (q: string) => call<RunResult>(`/run?q=${encodeURIComponent(q)}`),

  update: (args: { id?: string; q?: string; row: Cell[]; column: string; value: Cell }) =>
    post('/update', args),

  insert: (rel: string, row: Cell[]) => post('/insert', { rel, row }),

  /** Delete a fact by relation (complete row) or by the query it came from. */
  deleteRow: (args: { rel?: string; query?: string; row: Cell[] }) =>
    post('/delete', {
      ...(args.rel !== undefined ? { rel: args.rel } : {}),
      ...(args.query !== undefined ? { q: args.query } : {}),
      row: args.row,
    }),
}
