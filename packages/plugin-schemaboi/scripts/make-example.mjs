// Regenerates docs/contacts.sb — the schemaboi example the docs query.
// Run from the repo root:  node packages/plugin-schemaboi/scripts/make-example.mjs
import { writeFileSync } from 'node:fs'
import * as sb from 'schemaboi'

const appSchema = {
  id: 'ContactsApp',
  root: sb.ref('AddressBook'),
  types: {
    AddressBook: {
      fields: {
        owner: 'string',
        contacts: sb.list(sb.ref('Contact')),
      },
    },
    Contact: {
      fields: {
        name: 'string',
        age: { ...sb.prim('u32'), optional: true },
        color: sb.ref('Color'),
        tags: sb.list('string'),
      },
    },
    Color: sb.enumOfStrings('Red', 'Green', 'Blue'),
  },
}

const data = {
  owner: 'knarf',
  contacts: [
    { name: 'alice', age: 34, color: 'Red', tags: ['work'] },
    { name: 'bob', age: 27, color: 'Blue', tags: ['home', 'gym'] },
    { name: 'carol', age: null, color: 'Green', tags: [] },
    { name: 'dave', age: 41, color: 'Red', tags: ['work', 'home'] },
  ],
}

const out = new URL('../../../docs/contacts.sb', import.meta.url)
writeFileSync(out, sb.writeAppSchema(appSchema, data))
console.log(`wrote ${out.pathname}`)
