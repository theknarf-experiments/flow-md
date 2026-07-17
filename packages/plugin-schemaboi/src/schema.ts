// EDB relations for schemaboi files. A .sb file is self-describing — the
// schema travels with the data — so one parse yields two fact families:
//
// Schema side (what shapes exist):
//   SbSchema(path, id, root)                 the file's schema id + root type
//   SbType(path, type, kind)                 kind: 'struct' | 'enum' (in the
//                                            wire format a struct is just an
//                                            enum with one variant)
//   SbVariant(path, type, variant)           every variant ('Default' for
//                                            structs)
//   SbField(path, type, variant, field, ftype, optional)
//                                            ftype: 'string', 'u32', a type
//                                            name for refs, 'list<T>',
//                                            'map<K,V>'; optional is 0/1
//
// Data side (what values the file holds):
//   SbItem(path, item, type, variant)        every struct/enum instance and
//                                            list element; item ids are
//                                            paths: '$', '$.contacts[0]'
//   SbData(path, item, field, value)         scalar fields, stringified
//                                            (fieldless enums → the variant
//                                            name; bools → 'true'/'false')
//   SbNum(path, item, field, num)            typed sidecar for numeric
//                                            fields, mirroring CsvNumber
//   SbLink(path, item, field, child)         parent → nested item edges
//
//   SbError(path, error)                     parse failures, queryable
//
// A missing optional field emits no fact — absence is absence, the Datalog
// way. Scalar list elements become items with a single 'value' field so
// duplicates and order survive set semantics.

import type { EdbDef } from '@flow-md/plugin-api'

export const SB_SCHEMA: EdbDef[] = [
  { name: 'File', attrs: [['path', 'string'], ['mtime', 'number']] },
  {
    name: 'SbSchema',
    attrs: [['path', 'string'], ['id', 'string'], ['root', 'string']],
  },
  {
    name: 'SbType',
    attrs: [['path', 'string'], ['type', 'string'], ['kind', 'string']],
  },
  {
    name: 'SbVariant',
    attrs: [['path', 'string'], ['type', 'string'], ['variant', 'string']],
  },
  {
    name: 'SbField',
    attrs: [
      ['path', 'string'],
      ['type', 'string'],
      ['variant', 'string'],
      ['field', 'string'],
      ['ftype', 'string'],
      ['optional', 'number'],
    ],
  },
  {
    name: 'SbItem',
    attrs: [
      ['path', 'string'],
      ['item', 'string'],
      ['type', 'string'],
      ['variant', 'string'],
    ],
  },
  {
    name: 'SbData',
    attrs: [
      ['path', 'string'],
      ['item', 'string'],
      ['field', 'string'],
      ['value', 'string'],
    ],
  },
  {
    name: 'SbNum',
    attrs: [
      ['path', 'string'],
      ['item', 'string'],
      ['field', 'string'],
      ['num', 'float'],
    ],
  },
  {
    name: 'SbLink',
    attrs: [
      ['path', 'string'],
      ['item', 'string'],
      ['field', 'string'],
      ['child', 'string'],
    ],
  },
  {
    name: 'SbError',
    attrs: [['path', 'string'], ['error', 'string']],
  },
]
