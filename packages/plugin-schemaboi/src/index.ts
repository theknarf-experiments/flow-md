// The schemaboi plugin: claims `.sb` files — josephg's self-describing
// binary serialization format (https://github.com/josephg/schemaboi) — and
// exposes BOTH halves of a file to Datalog: the embedded schema (SbType/
// SbVariant/SbField) and the decoded data (SbItem/SbData/SbNum/SbLink).
// The vault hands us latin1-encoded bytes (binary: true). Write-back edits
// SbData.value / SbNum.num: decode, splice the value in schema-directed
// form, re-encode (see update.ts).

import type { Plugin } from '@flow-md/plugin-api'
import { parseSchemaboi } from './parse.js'
import { SB_SCHEMA } from './schema.js'
import { SB_WRITABLE, updateSbFact } from './update.js'

export const schemaboiPlugin: Plugin = {
  name: 'schemaboi',
  extensions: ['.sb'],
  binary: true,
  schema: SB_SCHEMA,
  parse: parseSchemaboi,
  writable: SB_WRITABLE,
  updateFact: updateSbFact,
}

export { parseSchemaboi, SB_SCHEMA, SB_WRITABLE, updateSbFact }
export default schemaboiPlugin
