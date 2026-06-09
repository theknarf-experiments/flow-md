// Zero-dependency RFC 4180-ish CSV reader/writer. Handles quoted fields
// (embedded commas, quotes, newlines) and both LF and CRLF row endings.
// Shared by parse (facts) and update (write-back).

export interface CsvTable {
  header: string[]
  /** Data rows (header excluded). */
  rows: string[][]
}

export function parseCsv(content: string): CsvTable {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  const pushField = () => {
    record.push(field)
    field = ''
  }
  const pushRecord = () => {
    pushField()
    records.push(record)
    record = []
  }
  for (let i = 0; i < content.length; i++) {
    const c = content[i]!
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      pushField()
    } else if (c === '\n') {
      if (field.endsWith('\r')) field = field.slice(0, -1)
      pushRecord()
    } else {
      field += c
    }
  }
  if (field !== '' || record.length > 0) pushRecord()
  // A trailing newline yields a phantom empty record; drop fully-empty rows.
  const all = records.filter((r) => r.length > 1 || r[0] !== '')
  const header = all[0] ?? []
  return { header, rows: all.slice(1) }
}

export function serializeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function serializeRow(row: readonly string[]): string {
  return row.map(serializeField).join(',')
}

export function serializeCsv(table: CsvTable, eol = '\n'): string {
  const lines = [serializeRow(table.header), ...table.rows.map(serializeRow)]
  return lines.join(eol) + eol
}
