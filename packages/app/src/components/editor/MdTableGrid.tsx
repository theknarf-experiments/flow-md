// Editable grid for one markdown pipe table, rendered inside the live
// editor's table widget on Tanstack Table. Click a cell (or the header) to
// edit it in place, add/delete rows and columns — every commit re-serializes
// the table and splices it back into the note's source.

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import type { MdTable } from '../../lib/mdtable.js'
import styles from './MdTableGrid.module.css'

interface Row {
  idx: number
  cells: string[]
}

export function MdTableGrid(props: {
  table: MdTable
  onCommit: (next: MdTable) => void
  onEditSource: () => void
}) {
  const { table, onCommit, onEditSource } = props
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(
    null,
  )
  const [draft, setDraft] = useState('')

  const data = useMemo<Row[]>(
    () => table.rows.map((cells, idx) => ({ idx, cells })),
    [table],
  )
  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      table.header.map((name, i) => ({
        id: `${i}`,
        header: name,
        accessorFn: (row: Row) => row.cells[i] ?? '',
      })),
    [table.header],
  )
  const grid = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const setCell = (row: number, col: number, value: string) => {
    onCommit({
      ...table,
      rows: table.rows.map((r, i) =>
        i === row ? r.map((c, j) => (j === col ? value : c)) : r,
      ),
    })
  }
  const setHeader = (col: number, value: string) => {
    onCommit({
      ...table,
      header: table.header.map((h, i) => (i === col ? value : h)),
    })
  }
  const addRow = () =>
    onCommit({ ...table, rows: [...table.rows, table.header.map(() => '')] })
  const deleteRow = (row: number) =>
    onCommit({ ...table, rows: table.rows.filter((_, i) => i !== row) })
  const addColumn = () =>
    onCommit({
      header: [...table.header, 'column'],
      aligns: [...table.aligns, ''],
      rows: table.rows.map((r) => [...r, '']),
    })

  const cellEditor = (commit: (value: string) => void, ghost: string) => (
    <span className={styles.editing}>
      <span className={styles.ghost}>{ghost}</span>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setEditing(null)
            commit(draft)
          }
          if (e.key === 'Escape') setEditing(null)
          e.stopPropagation() // keep keys out of the CodeMirror editor
        }}
      />
    </span>
  )

  return (
    <div className={styles.wrap} data-testid="md-table">
      <table className={styles.table}>
        <thead>
          <tr>
            {grid.getHeaderGroups()[0]!.headers.map((h, ci) => (
              <th
                key={h.id}
                style={alignStyle(table.aligns[ci])}
                onClick={() => {
                  setDraft(table.header[ci] ?? '')
                  setEditing({ row: -1, col: ci })
                }}
              >
                {editing?.row === -1 && editing.col === ci
                  ? cellEditor((v) => setHeader(ci, v), table.header[ci] ?? '')
                  : flexRender(h.column.columnDef.header, h.getContext())}
              </th>
            ))}
            <th className={styles.actions}>
              <button type="button" title="add column" onClick={addColumn}>
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.getRowModel().rows.map((row) => (
            <tr key={row.original.idx}>
              {row.getVisibleCells().map((cell, ci) => (
                <td
                  key={cell.id}
                  style={alignStyle(table.aligns[ci])}
                  onClick={() => {
                    setDraft(row.original.cells[ci] ?? '')
                    setEditing({ row: row.original.idx, col: ci })
                  }}
                >
                  {editing?.row === row.original.idx && editing.col === ci
                    ? cellEditor(
                        (v) => setCell(row.original.idx, ci, v),
                        row.original.cells[ci] ?? '',
                      )
                    : String(cell.getValue() ?? '')}
                </td>
              ))}
              <td className={styles.actions}>
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
        <button type="button" title="edit markdown source" onClick={onEditSource}>
          ✎
        </button>
      </div>
    </div>
  )
}

function alignStyle(align: MdTable['aligns'][number] | undefined) {
  return align ? { textAlign: align } : undefined
}
