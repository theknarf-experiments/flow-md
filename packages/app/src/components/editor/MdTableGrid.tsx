// The markdown pipe-table editor, rendered inside the live editor's table
// widget. The grid itself is @flow-md/ui's EditableGrid; what's specific here
// is the markdown round trip — carrying `aligns` through untouched so a
// commit can't lose the alignment row, and stopping keystrokes from reaching
// CodeMirror while a cell input has focus.

import { EditableGrid, type GridTable } from '@flow-md/ui'
import type { MdTable } from '../../lib/mdtable.js'

export function MdTableGrid(props: {
  table: MdTable
  onCommit: (next: MdTable) => void
  onEditSource: () => void
}) {
  const { table, onCommit, onEditSource } = props
  return (
    <EditableGrid
      table={table}
      onChange={(next: GridTable) =>
        onCommit({
          header: next.header,
          rows: next.rows,
          // The grid treats aligns as opaque and only ever appends '' for a
          // new column, which is in MdTable's narrower union — but it types
          // them as plain strings, so narrow them back here.
          aligns: (next.aligns ?? table.aligns) as MdTable['aligns'],
        })
      }
      editableHeader
      canAddColumn
      stopKeyPropagation
      data-testid="md-table"
      footerAction={
        <button type="button" title="edit as text" onClick={onEditSource}>
          ✎
        </button>
      }
    />
  )
}
