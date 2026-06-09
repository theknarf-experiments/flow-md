import type { Fact } from '@flow-md/plugin-api'
import { describe, expect, it } from 'vitest'
import { parseCsv, serializeCsv } from '../src/csv.js'
import { parseCsvFile, updateCsvFact } from '../src/index.js'

const SHEET = ['item,cost,note', 'milk,4,weekly', 'laptop,1200,"new, shiny"', 'pen,2,'].join('\n')

function rows(facts: Fact[], rel: string): unknown[][] {
  return facts.filter((f) => f.rel === rel).map((f) => f.row)
}

describe('parseCsv', () => {
  it('parses quoted fields with embedded commas and quotes', () => {
    const t = parseCsv('a,b\n"x,y","he said ""hi"""\n')
    expect(t.header).toEqual(['a', 'b'])
    expect(t.rows).toEqual([['x,y', 'he said "hi"']])
  })

  it('handles CRLF and trailing newlines', () => {
    const t = parseCsv('a,b\r\n1,2\r\n')
    expect(t.rows).toEqual([['1', '2']])
  })

  it('round-trips through serializeCsv', () => {
    const t = parseCsv(SHEET)
    expect(parseCsv(serializeCsv(t))).toEqual(t)
  })
})

describe('parseCsvFile', () => {
  const parsed = parseCsvFile('data/budget.csv', SHEET, 7)

  it('emits one CsvCell per cell, keyed by header name', () => {
    const cells = rows(parsed.facts, 'CsvCell')
    expect(cells).toContainEqual(['data/budget.csv', 1, 'item', 'milk'])
    expect(cells).toContainEqual(['data/budget.csv', 2, 'note', 'new, shiny'])
    expect(cells).toContainEqual(['data/budget.csv', 3, 'note', ''])
    expect(cells).toHaveLength(9)
  })

  it('emits typed CsvNumber facts for numeric cells only', () => {
    const nums = rows(parsed.facts, 'CsvNumber')
    expect(nums).toContainEqual(['data/budget.csv', 2, 'cost', 1200])
    expect(nums.some((r) => r[2] === 'item')).toBe(false)
  })

  it('emits a shared File fact', () => {
    expect(rows(parsed.facts, 'File')).toEqual([['data/budget.csv', 7]])
  })
})

describe('updateCsvFact', () => {
  const fact = (row: number, col: string, value: string): Fact => ({
    rel: 'CsvCell',
    row: ['data/budget.csv', row, col, value],
  })

  it('rewrites one cell and leaves other lines byte-identical', () => {
    const updated = updateCsvFact(SHEET, fact(1, 'cost', '4'), fact(1, 'cost', '5'))
    const lines = updated.split('\n')
    expect(lines[1]).toBe('milk,5,weekly')
    expect(lines[0]).toBe('item,cost,note')
    expect(lines[2]).toBe('laptop,1200,"new, shiny"')
    // Reparse: new fact present, old gone.
    const facts = parseCsvFile('data/budget.csv', updated, 0).facts
    expect(rows(facts, 'CsvCell')).toContainEqual(['data/budget.csv', 1, 'cost', '5'])
  })

  it('quotes values that need it', () => {
    const updated = updateCsvFact(
      SHEET,
      fact(1, 'note', 'weekly'),
      fact(1, 'note', 'every week, roughly'),
    )
    expect(updated.split('\n')[1]).toBe('milk,4,"every week, roughly"')
  })

  it('rejects stale values, unknown columns and key edits', () => {
    expect(() => updateCsvFact(SHEET, fact(1, 'cost', '99'), fact(1, 'cost', '5'))).toThrow(
      /is "4", not "99"/,
    )
    expect(() => updateCsvFact(SHEET, fact(1, 'nope', 'x'), fact(1, 'nope', 'y'))).toThrow(
      /no column "nope"/,
    )
    expect(() =>
      updateCsvFact(SHEET, fact(1, 'cost', '4'), {
        rel: 'CsvCell',
        row: ['data/budget.csv', 2, 'cost', '4'],
      }),
    ).toThrow(/only the value/)
  })

  it('rejects files where embedded newlines break line mapping', () => {
    const tricky = 'a,b\n"line\nbreak",2\n'
    expect(() =>
      updateCsvFact(
        tricky,
        { rel: 'CsvCell', row: ['x.csv', 1, 'b', '2'] },
        { rel: 'CsvCell', row: ['x.csv', 1, 'b', '3'] },
      ),
    ).toThrow(/read-only/)
  })
})
