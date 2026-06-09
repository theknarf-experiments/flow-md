// The iCalendar plugin: claims `.ics` files, contributes the Event* EDB
// relations (sharing `File` with the markdown plugin), and parses VEVENT
// components into per-attribute facts. ICS files host no rule or query
// blocks — they're a pure fact source.

import type { Plugin } from '@flow-md/plugin-api'
import { parseIcs } from './parse.js'
import { ICS_SCHEMA } from './schema.js'
import { ICS_WRITABLE, updateIcsFact } from './update.js'

export const icsPlugin: Plugin = {
  name: 'ics',
  extensions: ['.ics'],
  schema: ICS_SCHEMA,
  parse: parseIcs,
  writable: ICS_WRITABLE,
  updateFact: updateIcsFact,
}

export { parseIcs, ICS_SCHEMA, ICS_WRITABLE, updateIcsFact }
export default icsPlugin
