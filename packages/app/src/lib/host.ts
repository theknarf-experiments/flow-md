// The app's implementation of the view-plugin host (see @flow-md/view-api).
// This is the one place that wires plugin capabilities to the app's data
// layer: ad-hoc queries poll the server, cell writes go through the optimistic
// update path, the file list comes from the live notes collection.
//
// `openNote` and `resolveWiki` are passed in by the caller (LiveEditor),
// because they depend on per-editor context — the router and the current file
// list — that only exists where the editor renders. The query/file hooks and
// the cell writer are static (they use module singletons), so they live here.

import type { Cell, FlowMdHost, QueryState, UpdateCellArgs } from '@flow-md/view-api'
import { useLiveQuery } from '@tanstack/react-db'
import { api } from './api.js'
import { notesCollection } from './db.js'
import { usePoll } from './usePoll.js'

function useQuery(source: string, opts?: { intervalMs?: number }): QueryState {
  const poll = usePoll(() => api.run(source), [source], opts?.intervalMs ?? 3000)
  return {
    columns: poll.data?.columns ?? [],
    rows: poll.data?.rows ?? [],
    writable: poll.data?.writable ?? [],
    // /run returns 200 with an `error` field for Datalog errors, or `call`
    // throws (→ poll.error) for transport failures — surface either.
    error: poll.error ?? poll.data?.error ?? null,
    ready: poll.data != null,
    refresh: poll.refresh,
  }
}

function useFiles(): string[] {
  const { data } = useLiveQuery((q) => q.from({ n: notesCollection }))
  return (data ?? []).map((n) => n.path)
}

async function updateCell(args: UpdateCellArgs): Promise<void> {
  await api.update({
    q: args.query,
    row: args.row as Cell[],
    column: args.column,
    value: args.value,
  })
}

/** Build a host, given the per-editor navigation + wiki-resolution callbacks. */
export function makeHost(cbs: {
  openNote: (path: string) => void
  resolveWiki: (target: string) => string | null
}): FlowMdHost {
  return {
    useQuery,
    useFiles,
    updateCell,
    openNote: cbs.openNote,
    resolveWiki: cbs.resolveWiki,
  }
}
