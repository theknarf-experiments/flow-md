// The default viewer for `.csv` files. The grid is @flow-md/ui's
// EditableGrid; what's app-specific is the round trip — parse the text with
// the same @flow-md/plugin-csv the engine uses, re-serialize on every commit
// (preserving the file's line endings) and save through the notes collection,
// optimistically, so the grid never waits on the server.

import { parseCsv, serializeCsv } from '@flow-md/plugin-csv'
import { EditableGrid, type GridTable } from '@flow-md/ui'
import { useMemo, useState } from 'react'
import { saveNote } from '../lib/db.js'

export function CsvView(props: { path: string; content: string }) {
  const { path, content } = props
  const [error, setError] = useState<string | null>(null)

  const table = useMemo(() => parseCsv(content), [content])
  const eol = content.includes('\r\n') ? '\r\n' : '\n'

  const save = (next: GridTable) => {
    saveNote(path, serializeCsv({ header: next.header, rows: next.rows }, eol)).then(
      () => setError(null),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    )
  }

  return (
    <EditableGrid
      table={table}
      onChange={save}
      sortable
      data-testid="csv-view"
      status={error ? <span className="offline">{error}</span> : `${table.rows.length} rows`}
    />
  )
}
