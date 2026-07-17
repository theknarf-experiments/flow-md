// Parse a schemaboi file into facts. `readWithoutSchema` gives us both
// halves in one call — the embedded wire schema and the decoded value — and
// each is walked into its own fact family (see schema.ts for the relations).
//
// The traversal is schema-directed: we always know the expected SType of the
// value at hand, so items get their real type name (the decoded objects only
// carry a variant marker). Item ids are JSONPath-ish: '$' is the root,
// '$.contacts[0].address' a nested struct in a list.

import type { Cell, Fact, ParseResult } from '@flow-md/plugin-api'
import {
  type EnumSchema,
  type SType,
  type Schema,
  readWithoutSchema,
} from 'schemaboi'

/** Compact text form of a wire type, used for SbField.ftype and SbItem.type:
 *  primitives keep their name, refs become the referenced type's name. */
function typeName(t: SType): string {
  switch (t.type) {
    case 'ref':
      return t.key
    case 'list':
      return `list<${typeName(t.fieldType)}>`
    case 'map':
      return `map<${typeName(t.keyType)},${typeName(t.valType)}>`
    default:
      return t.type
  }
}

/** A struct is wire-encoded as an enum with a single variant. */
function kindOf(e: EnumSchema): 'struct' | 'enum' {
  return e.numericOnly || e.variants.size !== 1 ? 'enum' : 'struct'
}

export function scalarText(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v instanceof Uint8Array) {
    return v.length <= 32
      ? Buffer.from(v).toString('hex')
      : `(${v.length} bytes)`
  }
  return String(v)
}

export function scalarNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'bigint' && v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(v)
  }
  return null
}

class Walker {
  readonly facts: Fact[] = []

  constructor(
    private readonly path: string,
    private readonly schema: Schema,
  ) {}

  emit(rel: string, ...row: Cell[]): void {
    this.facts.push({ rel, row: [this.path, ...row] })
  }

  emitSchema(): void {
    this.emit(
      'SbSchema',
      this.schema.id,
      this.schema.root ? typeName(this.schema.root) : '',
    )
    for (const [name, type] of Object.entries(this.schema.types)) {
      this.emit('SbType', name, kindOf(type))
      for (const [variant, v] of type.variants) {
        this.emit('SbVariant', name, variant)
        if (!v.fields) continue
        for (const [field, f] of v.fields) {
          this.emit('SbField', name, variant, field, typeName(f.type), f.optional ? 1 : 0)
        }
      }
    }
  }

  /** Walk `value` (of wire type `t`) found at `field` of item `parent`.
   *  Scalars become SbData/SbNum rows on the parent; anything with identity
   *  (struct/enum-with-fields instances, list elements, maps) becomes its
   *  own item at `id`, linked from the parent. */
  visit(value: unknown, t: SType, parent: string, field: string, id: string): void {
    if (value === null || value === undefined) return // absent optional: no fact

    if (t.type === 'list') {
      const arr = value as unknown[]
      arr.forEach((el, i) => this.visit(el, t.fieldType, parent, field, `${id}[${i}]`))
      return
    }

    if (t.type === 'map') {
      this.item(id, typeName(t), '')
      this.emit('SbLink', parent, field, id)
      for (const [k, v] of mapEntries(value)) {
        this.visit(v, t.valType, id, scalarText(k), `${id}.${scalarText(k)}`)
      }
      return
    }

    if (t.type === 'ref') {
      const type = this.schema.types[t.key]
      // Fieldless enum values decode to plain variant-name strings — those
      // are scalars from Datalog's point of view.
      if (type && typeof value === 'object') {
        this.instance(value as Record<string, unknown>, t.key, type, parent, field, id)
        return
      }
    }

    this.scalar(value, parent, field, id, typeName(t))
  }

  /** A struct/enum-with-fields instance: its own item plus a link. */
  private instance(
    obj: Record<string, unknown>,
    type: string,
    schema: EnumSchema,
    parent: string,
    field: string,
    id: string,
  ): void {
    const variant =
      typeof obj.type === 'string' && schema.variants.has(obj.type)
        ? obj.type
        : (schema.variants.keys().next().value ?? '')
    this.item(id, type, variant)
    if (parent !== id) this.emit('SbLink', parent, field, id)
    const fields = schema.variants.get(variant)?.fields
    if (!fields) return
    for (const [name, f] of fields) {
      this.visit(obj[name], f.type, id, name, `${id}.${name}`)
    }
  }

  /** Scalars belonging to a list get their own item (so duplicates and
   *  order survive Datalog's set semantics); plain fields land on the
   *  parent item directly. In a list the passed `id` ends with "[i]". */
  private scalar(v: unknown, parent: string, field: string, id: string, ftype: string): void {
    const inList = id.endsWith(']')
    const owner = inList ? id : parent
    const key = inList ? 'value' : field
    if (inList) {
      this.item(id, ftype, '')
      this.emit('SbLink', parent, field, id)
    }
    this.emit('SbData', owner, key, scalarText(v))
    const n = scalarNum(v)
    if (n !== null) this.emit('SbNum', owner, key, n)
  }

  private item(id: string, type: string, variant: string): void {
    this.emit('SbItem', id, type, variant)
  }

  walkRoot(data: unknown): void {
    const root = this.schema.root
    if (!root || data === null || data === undefined) return
    if (root.type === 'ref' && typeof data === 'object' && !Array.isArray(data)) {
      const type = this.schema.types[root.key]
      if (type) {
        this.instance(data as Record<string, unknown>, root.key, type, '$', '', '$')
        return
      }
    }
    // Non-ref roots (a bare list/map/primitive at the top of the file).
    this.item('$', typeName(root), '')
    this.visit(data, root, '$', 'value', '$.value')
  }
}

function mapEntries(value: unknown): Array<[unknown, unknown]> {
  if (value instanceof Map) return [...value.entries()]
  if (Array.isArray(value)) return value as Array<[unknown, unknown]> // entryList form
  return Object.entries(value as Record<string, unknown>)
}

export function parseSchemaboi(
  path: string,
  content: string,
  mtime: number,
): ParseResult {
  const facts: Fact[] = [{ rel: 'File', row: [path, mtime] }]
  try {
    const bytes = new Uint8Array(Buffer.from(content, 'latin1'))
    const [schema, data] = readWithoutSchema(bytes)
    const walker = new Walker(path, schema)
    walker.emitSchema()
    walker.walkRoot(data)
    facts.push(...walker.facts)
  } catch (err) {
    facts.push({
      rel: 'SbError',
      row: [path, err instanceof Error ? err.message : String(err)],
    })
  }
  return { facts, rules: [], queries: [] }
}
