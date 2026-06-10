// GFM pipe-table parse/serialize for the live editor's table widget. The
// widget edits a structured grid (Tanstack Table) and round-trips through
// these helpers, so only the table's source block changes in the note.

export interface MdTable {
  header: string[]
  /** Alignment per column: '' | ':--' style left/center/right. */
  aligns: Array<'left' | 'center' | 'right' | ''>
  rows: string[][]
}

const splitRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!
    if (c === '\\' && trimmed[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (c === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  cells.push(cur.trim())
  return cells
}

export function parseMdTable(source: string): MdTable | null {
  const lines = source.split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) return null
  const header = splitRow(lines[0]!)
  const delim = splitRow(lines[1]!)
  if (!delim.every((d) => /^:?-+:?$/.test(d))) return null
  const aligns = header.map((_, i) => {
    const d = delim[i] ?? '---'
    if (d.startsWith(':') && d.endsWith(':')) return 'center' as const
    if (d.endsWith(':')) return 'right' as const
    if (d.startsWith(':')) return 'left' as const
    return '' as const
  })
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l)
    while (cells.length < header.length) cells.push('')
    return cells.slice(0, header.length)
  })
  return { header, aligns, rows }
}

export function serializeMdTable(table: MdTable): string {
  const widths = table.header.map((h, i) =>
    Math.max(
      3,
      h.length,
      ...table.rows.map((r) => (r[i] ?? '').length),
    ),
  )
  const pad = (s: string, i: number) => s.padEnd(widths[i]!)
  const delim = (i: number) => {
    const a = table.aligns[i] ?? ''
    const dashes = '-'.repeat(Math.max(widths[i]! - (a === 'center' ? 2 : a ? 1 : 0), 1))
    if (a === 'center') return `:${dashes}:`
    if (a === 'right') return `${dashes}:`
    if (a === 'left') return `:${dashes}`
    return '-'.repeat(widths[i]!)
  }
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => pad(c, i)).join(' | ')} |`
  return [
    line(table.header),
    `| ${table.header.map((_, i) => delim(i)).join(' | ')} |`,
    ...table.rows.map((r) => line(r)),
  ].join('\n')
}
