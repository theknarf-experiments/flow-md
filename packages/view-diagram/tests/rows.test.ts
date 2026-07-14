import { describe, expect, it } from 'vitest'
import { rowsAsObjects } from '../src/rows.js'

describe('rowsAsObjects', () => {
  it('keys each row by column name', () => {
    const rows = rowsAsObjects(
      ['path', 'status', 'line'],
      [
        ['a.md', 'open', 3],
        ['b.md', 'closed', 9],
      ],
    )
    expect(rows).toEqual([
      { path: 'a.md', status: 'open', line: 3 },
      { path: 'b.md', status: 'closed', line: 9 },
    ])
  })

  it('fills missing cells with empty strings', () => {
    expect(rowsAsObjects(['a', 'b'], [[1]])).toEqual([{ a: 1, b: '' }])
  })

  it('handles empty inputs', () => {
    expect(rowsAsObjects([], [])).toEqual([])
    expect(rowsAsObjects(['x'], [])).toEqual([])
  })
})
