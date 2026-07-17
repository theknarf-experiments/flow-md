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

/** One rendered cell: link-count cells summarize SbLink edges and aren't
 *  writable; value cells trace back to a live SbData fact, so they are. */
export interface CellInfo {
  value: string
  editable: boolean
}

export interface ItemTable {
  type: string
  columns: string[]
  rows: Array<{ path: string; item: string; cells: Record<string, CellInfo> }>
}

/** SbItem + SbData + SbLink rows (already path-filtered) → one table per
 *  type: columns are the union of that type's fields (links included —
 *  rendered as child counts), rows sorted by item id so list order holds.
 *  Items are keyed by (path, item): several .sb files all have a '$'. */
export function groupItems(items: Row[], data: Row[], links: Row[]): ItemTable[] {
  const key = (path: unknown, item: unknown) => `${path}\n${item}`
  const byItem = new Map<string, Record<string, CellInfo>>()
  const meta = new Map<string, { path: string; item: string; type: string }>()
  for (const [path, item, type] of items) {
    byItem.set(key(path, item), {})
    meta.set(key(path, item), {
      path: String(path),
      item: String(item),
      type: String(type),
    })
  }
  for (const [path, item, field, value] of data) {
    const cells = byItem.get(key(path, item))
    if (cells) cells[String(field)] = { value: String(value), editable: true }
  }
  const linkCount = new Map<string, Map<string, number>>()
  for (const [path, item, field] of links) {
    const m = linkCount.get(key(path, item)) ?? new Map<string, number>()
    m.set(String(field), (m.get(String(field)) ?? 0) + 1)
    linkCount.set(key(path, item), m)
  }
  for (const [k, m] of linkCount) {
    const cells = byItem.get(k)
    if (!cells) continue
    for (const [field, n] of m) {
      cells[field] ??= { value: `${n} item${n === 1 ? '' : 's'}`, editable: false }
    }
  }

  const tables = new Map<string, ItemTable>()
  for (const k of [...byItem.keys()].sort()) {
    const { path, item, type } = meta.get(k) ?? { path: '', item: '?', type: '?' }
    const table = tables.get(type) ?? { type, columns: [], rows: [] }
    const cells = byItem.get(k) ?? {}
    for (const col of Object.keys(cells)) {
      if (!table.columns.includes(col)) table.columns.push(col)
    }
    table.rows.push({ path, item, cells })
    tables.set(type, table)
  }
  return [...tables.values()]
}

/** Client-side path scoping, Calendar-style: the queries run vault-wide and
 *  a `path` prop narrows to one file. */
export function scope(rows: Row[], path: string | undefined): Row[] {
  return path === undefined ? rows : rows.filter((r) => r[0] === path)
}
