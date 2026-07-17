import { describe, expect, it } from 'vitest'
import { groupItems, groupSchema, scope } from '../src/group.js'

describe('groupSchema', () => {
  it('nests variants and fields under their types', () => {
    const out = groupSchema(
      [
        ['a.sb', 'Contact', 'struct'],
        ['a.sb', 'Color', 'enum'],
      ],
      [
        ['a.sb', 'Contact', 'Default'],
        ['a.sb', 'Color', 'Red'],
        ['a.sb', 'Color', 'Blue'],
      ],
      [['a.sb', 'Contact', 'Default', 'name', 'string', 0]],
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      name: 'Contact',
      kind: 'struct',
      variants: [
        { name: 'Default', fields: [{ field: 'name', ftype: 'string', optional: false }] },
      ],
    })
    expect(out[1]!.variants.map((v) => v.name)).toEqual(['Red', 'Blue'])
  })
})

describe('groupItems', () => {
  it('builds one table per type with union columns, sorted by item id', () => {
    const tables = groupItems(
      [
        ['a.sb', '$.contacts[1]', 'Contact', 'Default'],
        ['a.sb', '$.contacts[0]', 'Contact', 'Default'],
        ['a.sb', '$', 'AddressBook', 'Default'],
      ],
      [
        ['a.sb', '$', 'owner', 'knarf'],
        ['a.sb', '$.contacts[0]', 'name', 'alice'],
        ['a.sb', '$.contacts[0]', 'age', '34'],
        ['a.sb', '$.contacts[1]', 'name', 'bob'],
      ],
      [
        ['a.sb', '$', 'contacts', '$.contacts[0]'],
        ['a.sb', '$', 'contacts', '$.contacts[1]'],
      ],
    )
    const contact = tables.find((t) => t.type === 'Contact')
    expect(contact?.columns).toEqual(['name', 'age'])
    expect(contact?.rows.map((r) => r.item)).toEqual(['$.contacts[0]', '$.contacts[1]'])
    expect(contact?.rows[0]?.path).toBe('a.sb')
    const book = tables.find((t) => t.type === 'AddressBook')
    expect(book?.rows[0]?.cells).toEqual({
      owner: { value: 'knarf', editable: true },
      contacts: { value: '2 items', editable: false },
    })
  })

  it('keeps items from different files apart despite shared ids', () => {
    const tables = groupItems(
      [
        ['a.sb', '$', 'Doc', 'Default'],
        ['b.sb', '$', 'Doc', 'Default'],
      ],
      [
        ['a.sb', '$', 'title', 'one'],
        ['b.sb', '$', 'title', 'two'],
      ],
      [],
    )
    expect(tables[0]?.rows).toHaveLength(2)
    expect(tables[0]?.rows.map((r) => r.cells.title?.value).sort()).toEqual(['one', 'two'])
  })
})

describe('scope', () => {
  it('filters by path only when given one', () => {
    const rows = [
      ['a.sb', 'x'],
      ['b.sb', 'y'],
    ]
    expect(scope(rows, 'b.sb')).toEqual([['b.sb', 'y']])
    expect(scope(rows, undefined)).toEqual(rows)
  })
})
