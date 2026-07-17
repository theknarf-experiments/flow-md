// Datalog-driven schemaboi inspector — a flow-md view plugin. Reads the
// schemaboi plugin's Sb* facts off the server (no client-side .sb parsing)
// and renders the two halves of a self-describing file side by side:
//
//   • Schema — every type with its variants and typed fields
//   • Data   — one table per type, rows = decoded instances
//
// Two homes, like the calendar:
//
//   • the default viewer for `.sb` files (registered as a fileHandler), and
//   • an MDX component: <Schemaboi /> inspects every .sb file in the vault,
//     <Schemaboi path="data/contacts.sb" /> scopes to one file.
//
// Because it's just queries, the view is live: rewrite the .sb file and the
// tables re-render. And since the facts are ordinary relations, notes can
// query them directly (datalog-query fences over SbData etc.) without this
// component at all.

import { type FlowMdHost, type FlowMdViewPlugin, useFlowMd } from '@flow-md/view-api'
import { useState } from 'react'
import styles from './Schemaboi.module.css'
import { type ItemTable, groupItems, groupSchema, scope } from './group.js'

const INTERVAL = 5000
const SBDATA_QUERY = 'SbData(path, item, field, value)'

export function Schemaboi(props: { path?: string }) {
  const host = useFlowMd()
  const q = (source: string) => host.useQuery(source, { intervalMs: INTERVAL })
  const schemas = q('SbSchema(path, id, root)')
  const types = q('SbType(path, type, kind)')
  const variants = q('SbVariant(path, type, variant)')
  const fields = q('SbField(path, type, variant, field, ftype, optional)')
  const items = q('SbItem(path, item, type, variant)')
  const data = q('SbData(path, item, field, value)')
  const links = q('SbLink(path, item, field, child)')
  const errors = q('SbError(path, error)')

  if (schemas.error) return <p className="offline">schemaboi: {schemas.error}</p>
  if (!schemas.ready) return null

  const fileErrors = scope(errors.rows, props.path)
  const headers = scope(schemas.rows, props.path)
  const schema = groupSchema(
    scope(types.rows, props.path),
    scope(variants.rows, props.path),
    scope(fields.rows, props.path),
  )
  const tables = groupItems(
    scope(items.rows, props.path),
    scope(data.rows, props.path),
    scope(links.rows, props.path),
  )

  if (fileErrors.length > 0) {
    return (
      <div data-testid="schemaboi">
        {fileErrors.map(([path, error]) => (
          <p key={String(path)} className="offline">
            {path}: {String(error)}
          </p>
        ))}
      </div>
    )
  }
  if (headers.length === 0) {
    return <p className="hint">no schemaboi data{props.path ? ` in ${props.path}` : ''}</p>
  }

  return (
    <div className={styles.inspector} data-testid="schemaboi">
      {headers.map(([path, id, root]) => (
        <p key={String(path)} className={styles.header}>
          <strong>{String(id)}</strong>
          <span className={styles.dim}> · root {String(root)}</span>
          {props.path === undefined && <span className={styles.dim}> · {String(path)}</span>}
        </p>
      ))}

      <h3 className={styles.section}>Schema</h3>
      {schema.map((t) => (
        <section key={t.name} className={styles.type}>
          <h4 className={styles.typeName}>
            {t.name} <span className={styles.kind}>{t.kind}</span>
          </h4>
          {t.variants.map((v) =>
            v.fields.length > 0 ? (
              <table key={v.name} className={styles.table}>
                <thead>
                  <tr>
                    {t.kind === 'enum' && <th>{v.name}</th>}
                    <th>field</th>
                    <th>type</th>
                  </tr>
                </thead>
                <tbody>
                  {v.fields.map((f) => (
                    <tr key={f.field}>
                      {t.kind === 'enum' && <td />}
                      <td>
                        {f.field}
                        {f.optional && <span className={styles.dim}>?</span>}
                      </td>
                      <td className={styles.ftype}>{f.ftype}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : t.kind === 'enum' ? (
              <span key={v.name} className={styles.variant}>
                {v.name}
              </span>
            ) : null,
          )}
        </section>
      ))}

      <h3 className={styles.section}>Data</h3>
      {tables.map((table) => (
        <DataTable
          key={table.type}
          table={table}
          host={host}
          canEdit={data.writable.includes('value')}
          refresh={data.refresh}
        />
      ))}
    </div>
  )
}

/** One per-type table. Cells backed by an SbData fact edit in place (click,
 *  Enter commits, Esc cancels) — the write goes through the host's lineage-
 *  checked update path into the binary file, exactly like a CSV cell. */
function DataTable(props: {
  table: ItemTable
  host: FlowMdHost
  canEdit: boolean
  refresh: () => void
}) {
  const { table, host, canEdit, refresh } = props
  const [editing, setEditing] = useState<{ item: string; col: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const commit = (path: string, item: string, col: string, oldValue: string) => {
    setEditing(null)
    if (draft === oldValue) return
    host
      .updateCell({
        query: SBDATA_QUERY,
        row: [path, item, col, oldValue],
        column: 'value',
        value: draft,
      })
      .then(
        () => {
          setError(null)
          refresh()
        },
        (err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
      )
  }

  return (
    <section className={styles.type}>
      <h4 className={styles.typeName}>{table.type}</h4>
      {error && <p className="offline">{error}</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>item</th>
            {table.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={`${row.path}\n${row.item}`}>
              <td className={styles.dim}>{row.item}</td>
              {table.columns.map((c) => {
                const cell = row.cells[c]
                const editable = canEdit && cell?.editable === true
                if (editing && editing.item === row.item && editing.col === c && cell) {
                  return (
                    <td key={c} className={styles.editing}>
                      <input
                        className={styles.editInput}
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commit(row.path, row.item, c, cell.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit(row.path, row.item, c, cell.value)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                      />
                    </td>
                  )
                }
                return (
                  <td
                    key={c}
                    {...(editable
                      ? {
                          className: styles.editable,
                          title: 'click to edit',
                          onClick: () => {
                            setDraft(cell?.value ?? '')
                            setEditing({ item: row.item, col: c })
                          },
                        }
                      : {})}
                  >
                    {cell?.value ?? ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** The default viewer for `.sb` files: the inspector scoped to that file. */
function SbFileView({ path }: { path: string }) {
  return <Schemaboi path={path} />
}

export const schemaboiViewPlugin: FlowMdViewPlugin = {
  name: 'schemaboi-view',
  components: { Schemaboi },
  fileHandlers: { '.sb': SbFileView },
}

export default schemaboiViewPlugin
export { groupItems, groupSchema, scope } from './group.js'
export type { ItemTable, TypeInfo } from './group.js'
