import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { EditableGrid, type GridTable } from './EditableGrid.js'

const meta: Meta<typeof EditableGrid> = {
  title: 'EditableGrid',
  component: EditableGrid,
  args: { onChange: () => {} },
}
export default meta

type Story = StoryObj<typeof EditableGrid>

const TABLE: GridTable = {
  header: ['item', 'category', 'amount'],
  rows: [
    ['keyboard', 'hardware', '90'],
    ['coffee', 'supplies', '12'],
    ['monitor', 'hardware', '240'],
  ],
}

/** How `.csv` files render: sortable headers, editable cells, a row count. */
export const CsvMode: Story = {
  args: { table: TABLE, sortable: true, status: '3 rows' },
}

/** How markdown pipe tables render: headers are renamed rather than sorted,
 *  and a column can be added. */
export const MarkdownMode: Story = {
  args: {
    table: TABLE,
    editableHeader: true,
    canAddColumn: true,
    stopKeyPropagation: true,
    footerAction: (
      <button type="button" title="edit as text">
        ✎
      </button>
    ),
  },
}

export const Empty: Story = {
  args: { table: { header: ['name', 'value'], rows: [] }, sortable: true, status: '0 rows' },
}

export const WithError: Story = {
  args: {
    table: TABLE,
    sortable: true,
    status: <span style={{ color: 'var(--danger)' }}>could not save: server unreachable</span>,
  },
}

/** Editing actually works here — click a cell, type, Enter to commit. */
export const Interactive: Story = {
  render: () => {
    const [table, setTable] = useState<GridTable>(TABLE)
    return (
      <>
        <EditableGrid
          table={table}
          onChange={setTable}
          editableHeader
          canAddColumn
          status={`${table.rows.length} rows`}
        />
        <pre style={{ fontSize: '0.7rem', color: 'var(--fg-dim)' }}>
          {JSON.stringify(table, null, 1)}
        </pre>
      </>
    )
  },
}
