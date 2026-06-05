// Schema utilities. The EDB schema is no longer fixed: it's the union of the
// EDB relations declared by every registered plugin. These helpers compose a
// schema view (the merged decl list and a quick `name → exists` set) plus the
// `.in` section text used when assembling a Datalog program.

import type { EdbDef, Plugin } from '@flow-md/plugin-api'

export interface SchemaView {
  defs: EdbDef[]
  names: ReadonlySet<string>
}

/** Merge each plugin's EDB defs. A duplicate name across plugins is an error:
 *  two plugins claiming the same relation would produce ambiguous facts. */
export function buildSchema(plugins: readonly Plugin[]): SchemaView {
  const byName = new Map<string, { def: EdbDef; from: string }>()
  for (const p of plugins) {
    for (const def of p.schema) {
      const prev = byName.get(def.name)
      if (prev) {
        throw new Error(
          `plugin "${p.name}" redeclares EDB relation "${def.name}" (already from "${prev.from}")`,
        )
      }
      byName.set(def.name, { def, from: p.name })
    }
  }
  const defs = [...byName.values()].map((v) => v.def)
  return { defs, names: new Set(defs.map((d) => d.name)) }
}

/** The `.in` section declaring every EDB, for program assembly. */
export function edbSectionText(view: SchemaView): string {
  const decls = view.defs.map((e) => {
    const attrs = e.attrs.map(([n, t]) => `${n}: ${t}`).join(', ')
    return `.decl ${e.name}(${attrs})`
  })
  return `.in\n${decls.join('\n')}`
}
