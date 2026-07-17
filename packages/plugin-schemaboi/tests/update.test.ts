import * as sb from 'schemaboi'
import { describe, expect, it } from 'vitest'
import { parseSchemaboi } from '../src/parse.js'
import { updateSbFact } from '../src/update.js'

const asVaultContent = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('latin1')

const appSchema: sb.AppSchema = {
  id: 'ContactsApp',
  root: sb.ref('AddressBook'),
  types: {
    AddressBook: {
      fields: {
        owner: 'string',
        active: 'bool',
        contacts: sb.list(sb.ref('Contact')),
        tags: sb.list('string'),
      },
    },
    Contact: {
      fields: {
        name: 'string',
        age: { ...sb.prim('u32'), optional: true },
        color: sb.ref('Color'),
      },
    },
    Color: sb.enumOfStrings('Red', 'Green', 'Blue'),
  },
}

const makeContent = () =>
  asVaultContent(
    sb.writeAppSchema(appSchema, {
      owner: 'knarf',
      active: true,
      contacts: [
        { name: 'alice', age: 34, color: 'Red' },
        { name: 'bob', age: 27, color: 'Blue' },
      ],
      tags: ['home', 'work'],
    }),
  )

const dataRows = (content: string) =>
  parseSchemaboi('c.sb', content, 0)
    .facts.filter((f) => f.rel === 'SbData')
    .map((f) => f.row)

const upd = (
  content: string,
  rel: string,
  item: string,
  field: string,
  from: string | number,
  to: string | number,
) =>
  updateSbFact(
    content,
    { rel, row: ['c.sb', item, field, from] },
    { rel, row: ['c.sb', item, field, to] },
  )

describe('updateSbFact', () => {
  it('edits a string field on a nested list item', () => {
    const out = upd(makeContent(), 'SbData', '$.contacts[1]', 'name', 'bob', 'robert')
    expect(dataRows(out)).toContainEqual(['c.sb', '$.contacts[1]', 'name', 'robert'])
    expect(dataRows(out)).toContainEqual(['c.sb', '$.contacts[0]', 'name', 'alice'])
  })

  it('edits a number via SbNum and coerces strings via SbData', () => {
    const viaNum = upd(makeContent(), 'SbNum', '$.contacts[0]', 'age', 34, 35)
    const viaData = upd(makeContent(), 'SbData', '$.contacts[0]', 'age', '34', '35')
    for (const out of [viaNum, viaData]) {
      const nums = parseSchemaboi('c.sb', out, 0)
        .facts.filter((f) => f.rel === 'SbNum')
        .map((f) => f.row)
      expect(nums).toContainEqual(['c.sb', '$.contacts[0]', 'age', 35])
    }
  })

  it('switches a fieldless enum by variant name, rejecting unknowns', () => {
    const out = upd(makeContent(), 'SbData', '$.contacts[0]', 'color', 'Red', 'Green')
    expect(dataRows(out)).toContainEqual(['c.sb', '$.contacts[0]', 'color', 'Green'])
    expect(() =>
      upd(makeContent(), 'SbData', '$.contacts[0]', 'color', 'Red', 'Purple'),
    ).toThrow(/not a variant of Color.*Red, Green, Blue/)
  })

  it('edits bools and scalar list elements', () => {
    const flipped = upd(makeContent(), 'SbData', '$', 'active', 'true', 'false')
    expect(dataRows(flipped)).toContainEqual(['c.sb', '$', 'active', 'false'])
    const retagged = upd(makeContent(), 'SbData', '$.tags[1]', 'value', 'work', 'gym')
    expect(dataRows(retagged)).toContainEqual(['c.sb', '$.tags[1]', 'value', 'gym'])
    expect(dataRows(retagged)).toContainEqual(['c.sb', '$.tags[0]', 'value', 'home'])
  })

  it('rejects type-violating values', () => {
    expect(() =>
      upd(makeContent(), 'SbData', '$.contacts[0]', 'age', '34', '-1'),
    ).toThrow(/negative.*u32/)
    expect(() =>
      upd(makeContent(), 'SbData', '$.contacts[0]', 'age', '34', 'old'),
    ).toThrow(/not an integer/)
    expect(() =>
      upd(makeContent(), 'SbData', '$', 'active', 'true', 'yes'),
    ).toThrow(/true.*false/)
  })

  it('rejects stale edits and locator changes', () => {
    expect(() =>
      upd(makeContent(), 'SbData', '$.contacts[1]', 'name', 'billy', 'x'),
    ).toThrow(/no longer contains/)
    expect(() =>
      updateSbFact(
        makeContent(),
        { rel: 'SbData', row: ['c.sb', '$.contacts[1]', 'name', 'bob'] },
        { rel: 'SbData', row: ['c.sb', '$.contacts[0]', 'name', 'bob'] },
      ),
    ).toThrow(/only the value/)
  })

  it('edits a bare-scalar root file', () => {
    const content = asVaultContent(
      sb.writeAppSchema({ id: 'S', root: sb.String, types: {} }, 'hello'),
    )
    const out = upd(content, 'SbData', '$', 'value', 'hello', 'goodbye')
    expect(dataRows(out)).toContainEqual(['c.sb', '$', 'value', 'goodbye'])
  })

  it('round-trips: the rewritten file is still self-describing', () => {
    const out = upd(makeContent(), 'SbData', '$', 'owner', 'knarf', 'frank')
    const [schema, data] = sb.readWithoutSchema(
      new Uint8Array(Buffer.from(out, 'latin1')),
    )
    expect(schema.id).toBe('ContactsApp')
    expect((data as { owner: string }).owner).toBe('frank')
  })
})
