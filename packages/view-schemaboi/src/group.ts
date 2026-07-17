// Pure regrouping of the flat Sb* query rows into render-shaped structures.
// Row layouts follow the plugin's relations (path is always column 0).

export type Row = Array<string | number>

export interface TypeInfo {
  name: string
  kind: string
  variants: Array<{
    name: string
    fields: Array<{ field: string; ftype: string; optional: boolean }>
  }>
}

/** SbType + SbVariant + SbField rows (already path-filtered) → per-type
 *  shape, preserving first-seen order. */
export function groupSchema(
  types: Row[],
  variants: Row[],
  fields: Row[],
): TypeInfo[] {
  const out = new Map<string, TypeInfo>()
  for (const [, type, kind] of types) {
    out.set(String(type), { name: String(type), kind: String(kind), variants: [] })
  }
  for (const [, type, variant] of variants) {
    out.get(String(type))?.variants.push({ name: String(variant), fields: [] })
  }
  for (const [, type, variant, field, ftype, optional] of fields) {
    const v = out
      .get(String(type))
      ?.variants.find((x) => x.name === String(variant))
    v?.fields.push({
      field: String(field),
      ftype: String(ftype),
      optional: optional === 1,
    })
  }
  return [...out.values()]
}

export interface ItemTable {
  type: string
  columns: string[]
  rows: Array<{ item: string; cells: Record<string, string> }>
}

/** SbItem + SbData + SbLink rows (already path-filtered) → one table per
 *  type: columns are the union of that type's fields (links included —
 *  rendered as child counts), rows sorted by item id so list order holds. */
export function groupItems(items: Row[], data: Row[], links: Row[]): ItemTable[] {
  const byItem = new Map<string, Record<string, string>>()
  const typeOf = new Map<string, string>()
  for (const [, item, type] of items) {
    byItem.set(String(item), {})
    typeOf.set(String(item), String(type))
  }
  for (const [, item, field, value] of data) {
    const cells = byItem.get(String(item))
    if (cells) cells[String(field)] = String(value)
  }
  const linkCount = new Map<string, Map<string, number>>()
  for (const [, item, field] of links) {
    const m = linkCount.get(String(item)) ?? new Map<string, number>()
    m.set(String(field), (m.get(String(field)) ?? 0) + 1)
    linkCount.set(String(item), m)
  }
  for (const [item, m] of linkCount) {
    const cells = byItem.get(item)
    if (!cells) continue
    for (const [field, n] of m) cells[field] ??= `${n} item${n === 1 ? '' : 's'}`
  }

  const tables = new Map<string, ItemTable>()
  for (const item of [...byItem.keys()].sort()) {
    const type = typeOf.get(item) ?? '?'
    const table = tables.get(type) ?? { type, columns: [], rows: [] }
    const cells = byItem.get(item) ?? {}
    for (const col of Object.keys(cells)) {
      if (!table.columns.includes(col)) table.columns.push(col)
    }
    table.rows.push({ item, cells })
    tables.set(type, table)
  }
  return [...tables.values()]
}

/** Client-side path scoping, Calendar-style: the queries run vault-wide and
 *  a `path` prop narrows to one file. */
export function scope(rows: Row[], path: string | undefined): Row[] {
  return path === undefined ? rows : rows.filter((r) => r[0] === path)
}
