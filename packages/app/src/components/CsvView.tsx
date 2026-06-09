// CSV viewer/editor on Tanstack Table. Every cell is editable (click, type,
// Enter); rows can be appended and deleted. All edits rewrite the table and
// save through the notes collection — optimistic, so the grid never waits on
// the server. The parser/serializer comes from @flow-md/plugin-csv, so the
// app reads files exactly like the engine does.

import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { type CsvTable, parseCsv, serializeCsv } from '@flow-md/plugin-csv'
import { useMemo, useState } from 'react'
import { saveNote } from '../lib/db.js'
import styles from './CsvView.module.css'

interface Row {
  /** Stable identity = original data-row index (0-based). */
  idx: number
  cells: string[]
}

export function CsvView(props: { path: string; content: string }) {
  const { path, content } = props
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<{ idx: number; col: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const table = useMemo(() => parseCsv(content), [content])
  const data = useMemo<Row[]>(
    () => table.rows.map((cells, idx) => ({ idx, cells })),
    [table],
  )

  const save = (next: CsvTable) => {
    saveNote(path, serializeCsv(next, content.includes('\r\n') ? '\r\n' : '\n')).then(
      () => setError(null),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    )
  }

  const setCell = (idx: number, col: number, value: string) => {
    const rows = table.rows.map((r, i) => {
      if (i !== idx) return r
      const next = [...r]
      while (next.length < table.header.length) next.push('')
      next[col] = value
      return next
    })
    save({ header: table.header, rows })
  }

  const addRow = () => {
    save({
      header: table.header,
      rows: [...table.rows, table.header.map(() => '')],
    })
  }

  const deleteRow = (idx: number) => {
    save({ header: table.header, rows: table.rows.filter((_, i) => i !== idx) })
  }

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      table.header.map((name, i) => ({
        id: `${i}:${name}`,
        header: name,
        accessorFn: (row: Row) => row.cells[i] ?? '',
      })),
    [table.header],
  )

  const grid = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className={styles.csv} data-testid="csv-view">
      <table>
        <thead>
          {grid.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((h) => {
                const sort = h.column.getIsSorted()
                return (
                  <th
                    key={h.id}
                    className={styles.sortable}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    <span className={styles.sort}>
                      {sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : ''}
                    </span>
                  </th>
                )
              })}
              <th className={styles.rowActions} />
            </tr>
          ))}
        </thead>
        <tbody>
          {grid.getRowModel().rows.map((row) => (
            <tr key={row.original.idx}>
              {row.getVisibleCells().map((cell, ci) => {
                const isEditing =
                  editing?.idx === row.original.idx && editing.col === ci
                if (isEditing) {
                  return (
                    <td key={cell.id} className={styles.editing}>
                      <span className={styles.ghost}>
                        {String(cell.getValue() ?? '')}
                      </span>
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setEditing(null)
                            setCell(row.original.idx, ci, draft)
                          }
                          if (e.key === 'Escape') setEditing(null)
                        }}
                      />
                    </td>
                  )
                }
                return (
                  <td
                    key={cell.id}
                    className={styles.cell}
                    onClick={() => {
                      setDraft(String(cell.getValue() ?? ''))
                      setEditing({ idx: row.original.idx, col: ci })
                    }}
                  >
                    {String(cell.getValue() ?? '')}
                  </td>
                )
              })}
              <td className={styles.rowActions}>
                <button
                  type="button"
                  title="delete row"
                  onClick={() => deleteRow(row.original.idx)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.foot}>
        <button type="button" onClick={addRow}>
          + row
        </button>
        <span>
          {table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'}
        </span>
      </div>
      {error && <p className="offline">{error}</p>}
    </div>
  )
}
