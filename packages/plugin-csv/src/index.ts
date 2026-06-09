// The CSV plugin: claims `.csv` files and turns each data cell into facts so
// spreadsheets join against notes in Datalog. CSV files host no rule/query
// blocks — like ICS, they're a pure fact source.
//
// Schema (File is shared with the other plugins):
//   CsvCell(path, row, col, value)   one fact per cell; row is 1-based over
//                                    data rows (the header is row 0 nowhere —
//                                    headers become column names instead)
//   CsvNumber(path, row, col, num)   typed sidecar for numeric-looking cells,
//                                    mirroring Frontmatter/FrontmatterNumber
//
// Write-back: CsvCell.value is writable — the update path rewrites one cell
// in place, preserving the rest of the file byte-for-byte (only the target
// line is re-serialized).

import type { EdbDef, Fact, ParseResult, Plugin, WritableRel } from '@flow-md/plugin-api'
import { parseCsv, serializeRow } from './csv.js'

export const CSV_SCHEMA: EdbDef[] = [
  { name: 'File', attrs: [['path', 'string'], ['mtime', 'number']] },
  {
    name: 'CsvCell',
    attrs: [
      ['path', 'string'],
      ['row', 'number'],
      ['col', 'string'],
      ['value', 'string'],
    ],
  },
  {
    name: 'CsvNumber',
    attrs: [
      ['path', 'string'],
      ['row', 'number'],
      ['col', 'string'],
      ['num', 'float'],
    ],
  },
]

export const CSV_WRITABLE: WritableRel[] = [
  { rel: 'CsvCell', cols: ['value'] },
]

export function parseCsvFile(
  path: string,
  content: string,
  mtime: number,
): ParseResult {
  const facts: Fact[] = [{ rel: 'File', row: [path, mtime] }]
  const { header, rows } = parseCsv(content)
  rows.forEach((cells, r) => {
    header.forEach((col, c) => {
      const value = cells[c] ?? ''
      facts.push({ rel: 'CsvCell', row: [path, r + 1, col, value] })
      const num = Number(value)
      if (value.trim() !== '' && Number.isFinite(num)) {
        facts.push({ rel: 'CsvNumber', row: [path, r + 1, col, num] })
      }
    })
  })
  return { facts: dedup(facts), rules: [], queries: [] }
}

export function updateCsvFact(
  content: string,
  oldFact: Fact,
  newFact: Fact,
): string {
  if (oldFact.rel !== 'CsvCell' || newFact.rel !== 'CsvCell') {
    throw new Error(`relation "${oldFact.rel}" is not writable by the csv plugin`)
  }
  for (let i = 0; i < 3; i++) {
    if (oldFact.row[i] !== newFact.row[i]) {
      throw new Error('only the value of a CsvCell can be updated')
    }
  }
  const [, rowIdx, col, oldValue] = oldFact.row
  const { header, rows } = parseCsv(content)
  const c = header.indexOf(String(col))
  if (c < 0) throw new Error(`no column "${col}" in the header`)
  const r = Number(rowIdx) - 1
  const cells = rows[r]
  if (!cells) throw new Error(`no data row ${rowIdx}`)
  if ((cells[c] ?? '') !== String(oldValue)) {
    throw new Error(
      `cell (${rowIdx}, ${col}) is "${cells[c] ?? ''}", not "${oldValue}"`,
    )
  }
  const next = [...cells]
  next[c] = String(newFact.row[3] ?? '')

  // Replace only the target line; everything else stays byte-identical.
  // Data row r lives on physical line r+1 except when earlier fields embed
  // newlines — rare enough that we reject those files for cell write-back.
  const lines = content.split('\n')
  const expected = rows.length + 1
  const nonEmpty = lines.filter((l, i) => l !== '' || i < lines.length - 1).length
  if (nonEmpty !== expected) {
    throw new Error('cells with embedded newlines are read-only')
  }
  const eol = lines[r + 1]!.endsWith('\r') ? '\r' : ''
  lines[r + 1] = serializeRow(next) + eol
  return lines.join('\n')
}

export const csvPlugin: Plugin = {
  name: 'csv',
  extensions: ['.csv'],
  schema: CSV_SCHEMA,
  parse: parseCsvFile,
  writable: CSV_WRITABLE,
  updateFact: updateCsvFact,
}

export { parseCsv, serializeRow, serializeCsv, serializeField } from './csv.js'
export type { CsvTable } from './csv.js'
export default csvPlugin

const SEP = ''

function dedup(facts: Fact[]): Fact[] {
  const seen = new Set<string>()
  const out: Fact[] = []
  for (const f of facts) {
    const key = f.rel + SEP + f.row.join(SEP)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(f)
    }
  }
  return out
}
