import { describe, expect, it } from 'vitest'
import { parseMdTable, serializeMdTable } from '../src/lib/mdtable.js'

const TABLE = [
  '| name | role | age |',
  '| :--- | :--: | --: |',
  '| ada  | eng  | 36  |',
  '| lin  | pm   | 41  |',
].join('\n')

describe('parseMdTable', () => {
  const t = parseMdTable(TABLE)!

  it('parses header, alignment and rows', () => {
    expect(t.header).toEqual(['name', 'role', 'age'])
    expect(t.aligns).toEqual(['left', 'center', 'right'])
    expect(t.rows).toEqual([
      ['ada', 'eng', '36'],
      ['lin', 'pm', '41'],
    ])
  })

  it('handles missing outer pipes and ragged rows', () => {
    const ragged = parseMdTable('a | b\n--- | ---\nonly')!
    expect(ragged.header).toEqual(['a', 'b'])
    expect(ragged.rows).toEqual([['only', '']])
  })

  it('keeps escaped pipes inside cells', () => {
    const t2 = parseMdTable('| a |\n| - |\n| x \\| y |')!
    expect(t2.rows[0]![0]).toBe('x \\| y')
  })

  it('rejects non-tables', () => {
    expect(parseMdTable('just text')).toBeNull()
    expect(parseMdTable('| a |\n| not a delim |')).toBeNull()
  })
})

describe('serializeMdTable', () => {
  it('round-trips structure', () => {
    const t = parseMdTable(TABLE)!
    expect(parseMdTable(serializeMdTable(t))).toEqual(t)
  })

  it('pads columns and keeps alignment markers', () => {
    const out = serializeMdTable({
      header: ['x', 'long header'],
      aligns: ['', 'right'],
      rows: [['1', '2']],
    })
    const lines = out.split('\n')
    expect(lines[0]).toBe('| x   | long header |')
    expect(lines[1]).toMatch(/^\| -+ \| -+: \|$/)
    expect(lines[2]).toBe('| 1   | 2           |')
  })
})
