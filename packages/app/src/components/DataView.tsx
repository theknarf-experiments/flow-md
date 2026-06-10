// A live dataview: one `datalog-query` block rendered as a table, through
// Tanstack Table (headless) so columns sort for free — same pattern as
// example-web's RelationTable in the flow-ts repo.
//
// Columns the server marks writable are editable in place — click a cell,
// type, hit Enter, and the value is written back into the source file
// through the server's lineage-checked update path. The editing cell is
// keyed by the *row's content* (not its index), so a re-sort or a poll
// refresh can't silently move the editor onto a different logical row. A
// failed write (stale row, ambiguous trace) surfaces inline and the table
// refreshes to the server's truth.

import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import type { Cell, QueryResult } from '../lib/api.js'
import { editCell } from '../lib/db.js'
import styles from './DataView.module.css'

const rowKey = (row: Cell[]): string => JSON.stringify(row)

export function DataView(props: {
  source: string
  result: QueryResult | null
  /** Edit the query block's source text (wired by the markdown view). */
  onEditSource?: () => void
}) {
  const { source, result, onEditSource } = props
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<{ key: string; column: string } | null>(
    null,
  )
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const columns = useMemo<ColumnDef<Cell[]>[]>(
    () =>
      (result?.columns ?? []).map((name, i) => ({
        id: name,
        header: name,
        accessorFn: (row: Cell[]) => row[i],
      })),
    [result?.columns],
  )

  const table = useReactTable({
    data: result?.rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (!result) {
    return (
      <div className={styles.dataview} data-testid="dataview">
        <pre className={styles.source}>{source.trim()}</pre>
        <p className={styles.empty}>no results yet — is the server happy?</p>
      </div>
    )
  }

  const commit = (row: Cell[], column: string) => {
    setEditing(null)
    // Optimistic: the cell shows the new value immediately via the live
    // query; a rejected write rolls back and surfaces the server's reason.
    editCell(result.id, row, column, draft).then(
      () => setError(null),
      (err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
    )
  }

  return (
    <div className={styles.dataview} data-testid="dataview">
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((h) => {
                const sort = h.column.getIsSorted()
                return (
                  <th
                    key={h.id}
                    className={styles.sortable}
                    onClick={h.column.getToggleSortingHandler()}
                    aria-sort={
                      sort === 'asc'
                        ? 'ascending'
                        : sort === 'desc'
                          ? 'descending'
                          : 'none'
                    }
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {result.writable.includes(h.column.id) && (
                      <span className={styles.pen}> ✎</span>
                    )}
                    {/* Always rendered at a fixed width so toggling sort
                        doesn't change the column's measured size. */}
                    <span className={styles.sort}>
                      {sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : ''}
                    </span>
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={rowKey(row.original)}>
              {row.getVisibleCells().map((cell) => {
                const column = cell.column.id
                const writable = result.writable.includes(column)
                const isEditing =
                  editing?.key === rowKey(row.original) &&
                  editing.column === column
                if (isEditing) {
                  // The invisible ghost keeps the cell at the width the text
                  // had, so opening the editor never resizes the column; the
                  // input overlays it absolutely.
                  return (
                    <td key={cell.id} className={styles.editing}>
                      <span className={styles.cellGhost}>
                        {String(cell.getValue() ?? '')}
                      </span>
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit(row.original, column)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                      />
                    </td>
                  )
                }
                return (
                  <td
                    key={cell.id}
                    className={writable ? styles.writable : ''}
                    onClick={
                      writable
                        ? () => {
                            setDraft(String(cell.getValue() ?? ''))
                            setEditing({ key: rowKey(row.original), column })
                          }
                        : undefined
                    }
                  >
                    {String(cell.getValue() ?? '')}
                  </td>
                )
              })}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr>
              <td className={styles.empty} colSpan={result.columns.length}>
                no rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className={styles.foot}>
        <code>{result.source.trim()}</code>
        <span>
          {result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'}
          {onEditSource && (
            <button
              type="button"
              className={styles.editSource}
              title="edit query"
              data-testid="dataview-edit-source"
              onClick={onEditSource}
            >
              ✎
            </button>
          )}
        </span>
      </div>
      {error && <p className="offline">{error}</p>}
    </div>
  )
}
