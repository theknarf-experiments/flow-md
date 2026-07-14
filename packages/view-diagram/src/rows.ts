// Query rows as objects: MDX diagram authors write `r.status`, not `r[1]`.
// Pure, so it's unit-testable.

export type Cell = string | number

export type Row = Record<string, Cell>

export function rowsAsObjects(
  columns: readonly string[],
  rows: readonly Cell[][],
): Row[] {
  return rows.map((cells) => {
    const row: Row = {}
    columns.forEach((name, i) => {
      row[name] = cells[i] ?? ''
    })
    return row
  })
}
