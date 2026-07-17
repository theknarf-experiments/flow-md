// The schemaboi plugin: claims `.sb` files — josephg's self-describing
// binary serialization format (https://github.com/josephg/schemaboi) — and
// exposes BOTH halves of a file to Datalog: the embedded schema (SbType/
// SbVariant/SbField) and the decoded data (SbItem/SbData/SbNum/SbLink).
// Like ICS and CSV it's a pure fact source; being binary, the vault hands
// us latin1-encoded bytes and there is no write-back.

import type { Plugin } from '@flow-md/plugin-api'
import { parseSchemaboi } from './parse.js'
import { SB_SCHEMA } from './schema.js'

export const schemaboiPlugin: Plugin = {
  name: 'schemaboi',
  extensions: ['.sb'],
  binary: true,
  schema: SB_SCHEMA,
  parse: parseSchemaboi,
}

export { parseSchemaboi, SB_SCHEMA }
export default schemaboiPlugin
