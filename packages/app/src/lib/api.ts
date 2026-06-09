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

  files: async () => (await call<{ files: string[] }>('/files')).files,

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

  deleteFact: (rel: string, row: Cell[]) => post('/delete', { rel, row }),

  /** Toggle the GFM task at `line` of `file`. Pins path and line as
   *  constants so the row is fully determined, then writes the new status
   *  through the regular update path. */
  async toggleTask(file: string, line: number, open: boolean): Promise<void> {
    const q = `Task("${file}", status, text, ${line})`
    const r = await this.run(q)
    if (r.error) throw new Error(r.error)
    const row = r.rows[0]
    if (!row || r.rows.length !== 1) {
      throw new Error(`no unique task at ${file}:${line}`)
    }
    await this.update({ q, row, column: 'status', value: open ? 'open' : 'closed' })
  },
}
