// An editable table grid. The app had two of these — the markdown pipe-table
// editor and the CSV viewer — differing only in which affordances were on, so
// this is the union with the differences as flags.
//
// Data in, whole-table out: every mutation calls onChange with the next table
// and the caller decides what that means (re-serialize a markdown block, save
// a .csv). Nothing here knows about files or stores.

import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { type ReactNode, useMemo, useState } from 'react'
import styles from './EditableGrid.module.css'

export interface GridTable {
  header: string[]
  rows: string[][]
  /** Per-column alignment, carried through untouched for callers that have
   *  it (markdown tables); ignored here. */
  aligns?: string[]
}

export interface EditableGridProps {
  table: GridTable
  onChange: (next: GridTable) => void
  /** Click a header to rename it. Mutually exclusive with `sortable`, since
   *  both want the same click. */
  editableHeader?: boolean
  sortable?: boolean
  canAddRow?: boolean
  canAddColumn?: boolean
  canDeleteRow?: boolean
  /** Shown in the footer, e.g. a save error or a row count. */
  status?: ReactNode
  /** Extra footer control, e.g. an "edit source" escape hatch. */
  footerAction?: ReactNode
  /** Keep keystrokes from reaching a host editor — CodeMirror otherwise
   *  swallows them while a cell input has focus. */
  stopKeyPropagation?: boolean
  'data-testid'?: string
}

interface Row {
  idx: number
  cells: string[]
}

export function EditableGrid(props: EditableGridProps) {
  const {
    table,
    onChange,
    editableHeader = false,
    sortable = false,
    canAddRow = true,
    canAddColumn = false,
    canDeleteRow = true,
    status,
    footerAction,
    stopKeyPropagation = false,
    'data-testid': testId = 'editable-grid',
  } = props

  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null)
  const [draft, setDraft] = useState('')

  const data = useMemo<Row[]>(
    () => table.rows.map((cells, idx) => ({ idx, cells })),
    [table.rows],
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
    ...(sortable
      ? {
          state: { sorting },
          onSortingChange: setSorting,
          getSortedRowModel: getSortedRowModel(),
        }
      : {}),
    getCoreRowModel: getCoreRowModel(),
  })

  const setCell = (row: number, col: number, value: string) =>
    onChange({
      ...table,
      rows: table.rows.map((r, i) => {
        if (i !== row) return r
        // Short rows happen in real CSV; pad rather than write past the end.
        const next = [...r]
        while (next.length < table.header.length) next.push('')
        next[col] = value
        return next
      }),
    })

  const setHeader = (col: number, value: string) =>
    onChange({ ...table, header: table.header.map((h, i) => (i === col ? value : h)) })

  const addRow = () =>
    onChange({ ...table, rows: [...table.rows, table.header.map(() => '')] })

  const deleteRow = (row: number) =>
    onChange({ ...table, rows: table.rows.filter((_, i) => i !== row) })

  const addColumn = () =>
    onChange({
      ...table,
      header: [...table.header, 'column'],
      ...(table.aligns ? { aligns: [...table.aligns, ''] } : {}),
      rows: table.rows.map((r) => [...r, '']),
    })

  /** The invisible ghost holds the cell at the width its text had, so opening
   *  the editor never resizes the column; the input overlays it. */
  const cellEditor = (commit: (value: string) => void, ghost: string) => (
    <span className={styles.editing}>
      <span className={styles.ghost}>{ghost}</span>
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by a click
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
          if (stopKeyPropagation) e.stopPropagation()
        }}
      />
    </span>
  )

  const openEditor = (row: number, col: number, value: string) => {
    setDraft(value)
    setEditing({ row, col })
  }

  return (
    <div className={styles.wrap} data-testid={testId}>
      <table className={styles.table}>
        <thead>
          {grid.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((h, col) => {
                const sort = h.column.getIsSorted()
                const isEditing = editableHeader && editing?.row === -1 && editing.col === col
                return (
                  <th
                    key={h.id}
                    className={sortable || editableHeader ? styles.clickable : undefined}
                    {...(sortable
                      ? { onClick: h.column.getToggleSortingHandler(), 'aria-sort': ariaSort(sort) }
                      : {})}
                    {...(editableHeader
                      ? { onClick: () => openEditor(-1, col, table.header[col] ?? '') }
                      : {})}
                  >
                    {isEditing
                      ? cellEditor((v) => setHeader(col, v), table.header[col] ?? '')
                      : flexRender(h.column.columnDef.header, h.getContext())}
                    {sortable && sort && (
                      <span className={styles.sort}>{sort === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                )
              })}
              <th className={styles.actions}>
                {canAddColumn && (
                  <button type="button" title="add column" onClick={addColumn}>
                    ＋
                  </button>
                )}
              </th>
            </tr>
          ))}
        </thead>
        <tbody>
          {grid.getRowModel().rows.map((row) => (
            <tr key={row.original.idx}>
              {row.getVisibleCells().map((cell, col) => {
                const idx = row.original.idx
                const value = String(cell.getValue() ?? '')
                const isEditing = editing?.row === idx && editing.col === col
                return (
                  <td
                    key={cell.id}
                    className={styles.cell}
                    onClick={() => !isEditing && openEditor(idx, col, value)}
                  >
                    {isEditing ? cellEditor((v) => setCell(idx, col, v), value) : value}
                  </td>
                )
              })}
              <td className={styles.actions}>
                {canDeleteRow && (
                  <button
                    type="button"
                    title="delete row"
                    onClick={() => deleteRow(row.original.idx)}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.foot}>
        {canAddRow ? (
          <button type="button" onClick={addRow}>
            + row
          </button>
        ) : (
          <span />
        )}
        <span className={styles.status}>{status}</span>
        {footerAction}
      </div>
    </div>
  )
}

function ariaSort(sort: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  if (sort === 'asc') return 'ascending'
  if (sort === 'desc') return 'descending'
  return 'none'
}
