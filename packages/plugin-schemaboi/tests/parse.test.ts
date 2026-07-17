import * as sb from 'schemaboi'
import { describe, expect, it } from 'vitest'
import { parseSchemaboi } from '../src/parse.js'

// Bytes → what the vault hands a binary plugin: a latin1 string.
const asVaultContent = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('latin1')

const appSchema: sb.AppSchema = {
  id: 'ContactsApp',
  root: sb.ref('AddressBook'),
  types: {
    AddressBook: {
      fields: {
        owner: 'string',
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

const data = {
  owner: 'knarf',
  contacts: [
    { name: 'alice', age: 34, color: 'Red' },
    { name: 'bob', age: null, color: 'Blue' },
  ],
  tags: ['home', 'home', 'work'],
}

const content = asVaultContent(sb.writeAppSchema(appSchema, data))
const result = parseSchemaboi('contacts.sb', content, 42)
const rows = (rel: string) =>
  result.facts.filter((f) => f.rel === rel).map((f) => f.row)

describe('parseSchemaboi — schema side', () => {
  it('emits the schema id and root', () => {
    expect(rows('SbSchema')).toEqual([['contacts.sb', 'ContactsApp', 'AddressBook']])
  })

  it('classifies structs vs enums', () => {
    const kinds = new Map(rows('SbType').map(([, t, k]) => [t, k]))
    expect(kinds.get('AddressBook')).toBe('struct')
    expect(kinds.get('Contact')).toBe('struct')
    expect(kinds.get('Color')).toBe('enum')
  })

  it('emits variants and typed fields', () => {
    expect(rows('SbVariant')).toContainEqual(['contacts.sb', 'Color', 'Green'])
    const fields = rows('SbField')
    expect(fields).toContainEqual([
      'contacts.sb', 'Contact', 'Default', 'age', 'u32', 1,
    ])
    expect(fields).toContainEqual([
      'contacts.sb', 'Contact', 'Default', 'color', 'Color', 0,
    ])
    expect(fields).toContainEqual([
      'contacts.sb', 'AddressBook', 'Default', 'contacts', 'list<Contact>', 0,
    ])
  })
})

describe('parseSchemaboi — data side', () => {
  it('emits typed items with JSONPath-ish ids', () => {
    const items = rows('SbItem')
    expect(items).toContainEqual(['contacts.sb', '$', 'AddressBook', 'Default'])
    expect(items).toContainEqual(['contacts.sb', '$.contacts[0]', 'Contact', 'Default'])
    expect(items).toContainEqual(['contacts.sb', '$.contacts[1]', 'Contact', 'Default'])
  })

  it('links nested items to their parent field', () => {
    expect(rows('SbLink')).toContainEqual([
      'contacts.sb', '$', 'contacts', '$.contacts[1]',
    ])
  })

  it('emits scalar fields, fieldless enums as variant names', () => {
    const data = rows('SbData')
    expect(data).toContainEqual(['contacts.sb', '$', 'owner', 'knarf'])
    expect(data).toContainEqual(['contacts.sb', '$.contacts[0]', 'name', 'alice'])
    expect(data).toContainEqual(['contacts.sb', '$.contacts[0]', 'color', 'Red'])
  })

  it('mirrors numbers into SbNum', () => {
    expect(rows('SbNum')).toContainEqual(['contacts.sb', '$.contacts[0]', 'age', 34])
  })

  it('emits nothing for an absent optional field', () => {
    const bobFacts = result.facts.filter(
      (f) => f.row[1] === '$.contacts[1]' && f.row[2] === 'age',
    )
    expect(bobFacts).toHaveLength(0)
  })

  it('keeps duplicate scalar list elements distinct via per-element items', () => {
    const tagValues = rows('SbData').filter(
      ([, item]) => String(item).startsWith('$.tags['),
    )
    expect(tagValues).toHaveLength(3)
    expect(rows('SbItem')).toContainEqual(['contacts.sb', '$.tags[1]', 'string', ''])
  })
})

describe('parseSchemaboi — failure', () => {
  it('turns corrupt bytes into a queryable SbError', () => {
    const bad = parseSchemaboi('bad.sb', 'not schemaboi at all', 1)
    expect(bad.facts[0]).toEqual({ rel: 'File', row: ['bad.sb', 1] })
    const errs = bad.facts.filter((f) => f.rel === 'SbError')
    expect(errs).toHaveLength(1)
    expect(errs[0]!.row[0]).toBe('bad.sb')
  })

  it('round-trips non-ascii bytes through the latin1 convention', () => {
    const emoji = sb.writeAppSchema(
      { id: 'S', root: sb.String, types: {} },
      'héllo 🌍',
    )
    const parsed = parseSchemaboi('s.sb', asVaultContent(emoji), 1)
    const values = parsed.facts.filter((f) => f.rel === 'SbData').map((f) => f.row[3])
    expect(values).toContain('héllo 🌍')
  })
})
