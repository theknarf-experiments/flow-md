// The app's data layer: two TanStack DB collections mirroring the flow-md
// server, with optimistic write-through mutations.
//
//   notes    one row per vault file { path, content, mtime }, synced in bulk
//            from GET /contents. Updating a note's content saves the whole
//            file (PUT /file) — editor saves and checkbox toggles both go
//            through here, so they render instantly from the optimistic
//            overlay and roll back automatically if the save fails.
//   queries  one row per registered query block (the server's QueryResult,
//            keyed by id). Editing a cell updates the row optimistically;
//            the write-through handler diffs original vs modified to recover
//            (row, column, value) and posts the lineage-checked /update.
//
// Both collections poll (TanStack Query refetchInterval) — that's the
// liveness mechanism, same cadence the usePoll version had — and each
// mutation handler refetches the *other* collection, since a content change
// moves query results and a cell edit rewrites file content.
//
// Offline: the query cache persists to localStorage (sync persister), so a
// reload without a reachable server still renders the vault from the last
// sync. Mutations made while offline fail their handler and roll back —
// flow-md is the source of truth, not a CRDT.

import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { persistQueryClient } from '@tanstack/query-persist-client-core'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { createCollection } from '@tanstack/react-db'
import { type Cell, type QueryResult, api } from './api.js'

export interface Note {
  path: string
  content: string
  mtime: number
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // the refetch interval is the retry
      gcTime: 7 * 24 * 60 * 60 * 1000,
    },
  },
})

// Guarded: this module is also evaluated during the build's prerender pass,
// where there is no localStorage (and no server to sync from).
if (typeof window !== 'undefined') {
  persistQueryClient({
    queryClient,
    persister: createSyncStoragePersister({
      storage: window.localStorage,
      key: 'flow-md-cache',
    }),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

export const notesCollection = createCollection(
  queryCollectionOptions<Note>({
    id: 'notes',
    queryKey: ['notes'],
    queryFn: () => api.contents(),
    getKey: (n) => n.path,
    queryClient,
    refetchInterval: 3000,
    onInsert: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const note = m.modified as Note
        await api.saveFile(note.path, note.content)
      }
      void queriesCollection.utils.refetch()
    },
    onUpdate: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const note = m.modified as Note
        await api.saveFile(note.path, note.content)
      }
      void queriesCollection.utils.refetch()
    },
  }),
)

export const queriesCollection = createCollection(
  queryCollectionOptions<QueryResult>({
    id: 'queries',
    queryKey: ['queries'],
    queryFn: () => api.allQueries(),
    getKey: (q) => q.id,
    queryClient,
    refetchInterval: 2000,
    onUpdate: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const original = m.original as QueryResult
        const change = changedCell(original, m.modified as QueryResult)
        if (!change) continue
        await api.update({ id: original.id, ...change })
      }
      void notesCollection.utils.refetch()
    },
  }),
)

/** Recover the single edited cell from an optimistic QueryResult update. */
function changedCell(
  original: QueryResult,
  modified: QueryResult,
): { row: Cell[]; column: string; value: Cell } | null {
  for (let ri = 0; ri < original.rows.length; ri++) {
    const before = original.rows[ri]!
    const after = modified.rows[ri]
    if (!after) continue
    for (let ci = 0; ci < before.length; ci++) {
      if (before[ci] !== after[ci]) {
        return { row: before, column: original.columns[ci]!, value: after[ci]! }
      }
    }
  }
  return null
}

// --- mutations ---------------------------------------------------------------
// Each returns a promise that resolves when the server confirmed the write
// (and rejects after the optimistic state has been rolled back).

export function saveNote(path: string, content: string): Promise<unknown> {
  const tx = notesCollection.update(path, (draft) => {
    draft.content = content
  })
  return tx.isPersisted.promise
}

export function newNote(path: string): Promise<unknown> {
  const title = path.split('/').at(-1)!.replace(/\.md$/, '')
  const tx = notesCollection.insert({
    path,
    content: `# ${title}\n`,
    mtime: 0,
  })
  return tx.isPersisted.promise
}

/** Flip the checkbox on `line` (1-based) of the note. Optimistic: the
 *  markdown re-renders from the overlay before the save round-trips. */
export function toggleTask(
  path: string,
  line: number,
  checked: boolean,
): Promise<unknown> {
  const tx = notesCollection.update(path, (draft) => {
    const lines = draft.content.split('\n')
    const cur = lines[line - 1]
    if (cur === undefined) throw new Error(`no line ${line} in ${path}`)
    lines[line - 1] = cur.replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]')
    draft.content = lines.join('\n')
  })
  return tx.isPersisted.promise
}

export function editCell(
  id: string,
  row: Cell[],
  column: string,
  value: Cell,
): Promise<unknown> {
  const tx = queriesCollection.update(id, (draft) => {
    const ri = draft.rows.findIndex(
      (r) => JSON.stringify(r) === JSON.stringify(row),
    )
    const ci = draft.columns.indexOf(column)
    if (ri < 0 || ci < 0) throw new Error('row no longer in the result set')
    draft.rows[ri]![ci] = value
  })
  return tx.isPersisted.promise
}
