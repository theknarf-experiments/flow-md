// Write-back for schemaboi files. An edit to SbData.value (or SbNum.num)
// decodes the file with its embedded schema, walks to the fact's item/field
// (schema-directed, so we know the wire type of the leaf), coerces the new
// value to that type, and re-encodes the whole file — the schema travels
// along unchanged, so the result is the same self-describing format.
//
// Locator columns (path, item, field) are immutable; only the value column
// updates. The current value is re-checked against the old fact right before
// the splice — same staleness contract as the text plugins.

import type { Cell, Fact, WritableRel } from '@flow-md/plugin-api'
import {
  type EnumSchema,
  type SType,
  type Schema,
  readWithoutSchema,
  write,
} from 'schemaboi'
import { scalarNum, scalarText } from './parse.js'

export const SB_WRITABLE: WritableRel[] = [
  { rel: 'SbData', cols: ['value'] },
  { rel: 'SbNum', cols: ['num'] },
]

type Seg = { kind: 'field'; name: string } | { kind: 'index'; i: number }

/** '$.contacts[0].name' → field/index segments (the '$' root is implicit). */
function parseItemId(id: string): Seg[] {
  if (id === '$') return []
  if (!id.startsWith('$')) throw new Error(`malformed item id "${id}"`)
  const segs: Seg[] = []
  const re = /\.([^.[\]]+)|\[(\d+)\]/g
  let consumed = 1
  for (const m of id.matchAll(re)) {
    if (m.index !== consumed) throw new Error(`malformed item id "${id}"`)
    consumed += m[0].length
    segs.push(
      m[1] !== undefined
        ? { kind: 'field', name: m[1] }
        : { kind: 'index', i: Number(m[2]) },
    )
  }
  if (consumed !== id.length) throw new Error(`malformed item id "${id}"`)
  return segs
}

/** A mutable slot in the decoded value tree. */
interface Slot {
  get(): unknown
  set(v: unknown): void
}

function variantOf(obj: Record<string, unknown>, es: EnumSchema): string {
  return typeof obj.type === 'string' && es.variants.has(obj.type)
    ? obj.type
    : (es.variants.keys().next().value ?? '')
}

/** Move one segment deeper: returns the child slot and its wire type. */
function step(schema: Schema, slot: Slot, t: SType, seg: Seg): [Slot, SType] {
  const node = slot.get()
  if (seg.kind === 'index') {
    if (t.type !== 'list' || !Array.isArray(node)) {
      throw new Error(`"[${seg.i}]" does not index a list`)
    }
    const arr = node
    return [{ get: () => arr[seg.i], set: (v) => { arr[seg.i] = v } }, t.fieldType]
  }
  const name = seg.name
  if (t.type === 'ref') {
    const es = schema.types[t.key]
    if (!es || typeof node !== 'object' || node === null) {
      throw new Error(`"${name}" does not address a ${t.key} instance`)
    }
    const obj = node as Record<string, unknown>
    const field = es.variants.get(variantOf(obj, es))?.fields?.get(name)
    if (!field) throw new Error(`no field "${name}" on ${t.key}`)
    return [{ get: () => obj[name], set: (v) => { obj[name] = v } }, field.type]
  }
  if (t.type === 'map') {
    if (node instanceof Map) {
      const map = node
      return [{ get: () => map.get(name), set: (v) => map.set(name, v) }, t.valType]
    }
    if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
      const obj = node as Record<string, unknown>
      return [{ get: () => obj[name], set: (v) => { obj[name] = v } }, t.valType]
    }
    throw new Error(`"${name}" does not address a map entry`)
  }
  throw new Error(`"${name}" does not address a struct field or map entry`)
}

/** New raw cell → a value of wire type `t`, or a descriptive error. */
function coerce(schema: Schema, t: SType, raw: Cell): unknown {
  switch (t.type) {
    case 'string':
    case 'id':
      return String(raw)
    case 'bool': {
      if (raw === 'true' || raw === 'false') return raw === 'true'
      throw new Error(`bool fields take "true" or "false", not "${raw}"`)
    }
    case 'f32':
    case 'f64': {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new Error(`"${raw}" is not a number`)
      return n
    }
    case 'u8': case 'u16': case 'u32': case 'u64': case 'u128':
    case 's8': case 's16': case 's32': case 's64': case 's128': {
      const n = Number(raw)
      if (!Number.isInteger(n)) throw new Error(`"${raw}" is not an integer`)
      if (t.type.startsWith('u') && n < 0) {
        throw new Error(`"${raw}" is negative but the field is ${t.type}`)
      }
      return n
    }
    case 'binary':
      throw new Error('binary fields are not editable')
    case 'ref': {
      const es = schema.types[t.key]
      if (!es) throw new Error(`unknown type "${t.key}"`)
      const v = String(raw)
      if (!es.variants.has(v)) {
        throw new Error(
          `"${v}" is not a variant of ${t.key} (expected one of: ${[...es.variants.keys()].join(', ')})`,
        )
      }
      const fields = es.variants.get(v)?.fields
      if (fields && fields.size > 0) {
        throw new Error(`variant "${v}" of ${t.key} carries fields and can't be set by name`)
      }
      return v
    }
    default:
      throw new Error(`${t.type} values are not editable`)
  }
}

export function updateSbFact(
  content: string,
  oldFact: Fact,
  newFact: Fact,
): string {
  const rel = oldFact.rel
  if ((rel !== 'SbData' && rel !== 'SbNum') || newFact.rel !== rel) {
    throw new Error(`relation "${rel}" is not writable by the schemaboi plugin`)
  }
  for (let i = 0; i < 3; i++) {
    if (oldFact.row[i] !== newFact.row[i]) {
      throw new Error(`only the ${rel === 'SbNum' ? 'num' : 'value'} of a ${rel} fact can be updated`)
    }
  }

  const bytes = new Uint8Array(Buffer.from(content, 'latin1'))
  const [schema, data] = readWithoutSchema(bytes)
  if (!schema.root) throw new Error('the file has no root type')

  // Walk to the item, then to the field. Scalar list elements are their own
  // items addressed as `parent[i]` with the single field 'value' — for those
  // the item slot itself is the leaf.
  const item = String(oldFact.row[1])
  const field = String(oldFact.row[2])
  const box = { root: data as unknown }
  let slot: Slot = { get: () => box.root, set: (v) => { box.root = v } }
  let t: SType = schema.root
  for (const seg of parseItemId(item)) {
    ;[slot, t] = step(schema, slot, t, seg)
  }
  const itemIsScalar =
    t.type !== 'map' &&
    (t.type !== 'ref' || typeof slot.get() !== 'object' || slot.get() === null)
  if (!itemIsScalar) {
    ;[slot, t] = step(schema, slot, t, { kind: 'field', name: field })
  } else if (field !== 'value') {
    throw new Error(`scalar item "${item}" only has the field "value"`)
  }

  const current = slot.get()
  const stale =
    rel === 'SbNum'
      ? scalarNum(current) !== Number(oldFact.row[3])
      : scalarText(current) !== String(oldFact.row[3])
  if (stale) {
    throw new Error('the file changed and no longer contains the value being updated')
  }

  slot.set(coerce(schema, t, newFact.row[3] as Cell))
  return Buffer.from(write(schema, box.root)).toString('latin1')
}
