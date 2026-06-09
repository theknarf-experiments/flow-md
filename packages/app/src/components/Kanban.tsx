// Datalog-driven kanban board, designed to be dropped into an MDX note:
//
//   <Kanban query="Task(path, status, text, line)"
//           groupBy="status" title="text" lanes="open,closed" />
//
// Rows of the query become cards; `groupBy` names the column whose value
// picks the lane; `lanes` (optional) fixes lane order and shows empty lanes.
// The ◀ ▶ buttons move a card to the neighbouring lane by writing the new
// value through the server's lineage-checked /update — so with the Task
// example, moving a card literally rewrites the checkbox in the source note.

import { useMemo, useState } from 'react'
import { type Cell, api } from '../lib/api.js'
import { usePoll } from '../lib/usePoll.js'
import styles from './Kanban.module.css'

export function Kanban(props: {
  query: string
  groupBy: string
  title?: string
  lanes?: string
}) {
  const { query, groupBy, title, lanes } = props
  const [error, setError] = useState<string | null>(null)
  const result = usePoll(() => api.run(query), [query], 2500)

  const columns = result.data?.columns ?? []
  const rows = result.data?.rows ?? []
  const groupIdx = columns.indexOf(groupBy)
  const titleIdx = title ? columns.indexOf(title) : -1
  const writable = result.data?.writable.includes(groupBy) ?? false

  const laneNames = useMemo(() => {
    const declared = (lanes ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const seen = new Set(declared)
    const out = [...declared]
    if (groupIdx >= 0) {
      for (const row of rows) {
        const lane = String(row[groupIdx])
        if (!seen.has(lane)) {
          seen.add(lane)
          out.push(lane)
        }
      }
    }
    return out
  }, [lanes, rows, groupIdx])

  if (result.error || result.data?.error) {
    return <p className="offline">kanban: {result.error ?? result.data?.error}</p>
  }
  if (result.data && groupIdx < 0) {
    return (
      <p className="offline">
        kanban: query has no column "{groupBy}" (columns: {columns.join(', ')})
      </p>
    )
  }

  // Card footers show the remaining columns, but only while that stays
  // compact — a wide query degrades to title-only cards.
  const metaCols = columns.filter((c, i) => i !== titleIdx && i !== groupIdx && c)
  const showMeta = titleIdx >= 0 && metaCols.length <= 2

  const move = (row: Cell[], to: string) => {
    api
      .update({ q: query, row, column: groupBy, value: to })
      .then(() => result.refresh())
      .then(
        () => setError(null),
        (err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
      )
  }

  return (
    <div className={styles.board} data-testid="kanban">
      {laneNames.map((lane, li) => {
        const cards = rows.filter((r) => String(r[groupIdx]) === lane)
        return (
          <section key={lane} className={styles.lane}>
            <h4 className={styles.laneTitle}>
              {lane} <span className={styles.count}>{cards.length}</span>
            </h4>
            <ul className={styles.cards}>
              {cards.map((row) => (
                <li key={JSON.stringify(row)} className={styles.card}>
                  {writable && li > 0 && (
                    <button
                      type="button"
                      className={styles.move}
                      title={`move to ${laneNames[li - 1]}`}
                      onClick={() => move(row, laneNames[li - 1]!)}
                    >
                      ◀
                    </button>
                  )}
                  <span className={styles.cardBody}>
                    <span className={styles.cardTitle}>
                      {String(titleIdx >= 0 ? row[titleIdx] : row.join(' · '))}
                    </span>
                    {showMeta && (
                      <span className={styles.cardMeta}>
                        {metaCols
                          .map((c) => `${c}: ${row[columns.indexOf(c)]}`)
                          .join('  ')}
                      </span>
                    )}
                  </span>
                  {writable && li < laneNames.length - 1 && (
                    <button
                      type="button"
                      className={styles.move}
                      title={`move to ${laneNames[li + 1]}`}
                      onClick={() => move(row, laneNames[li + 1]!)}
                    >
                      ▶
                    </button>
                  )}
                </li>
              ))}
              {cards.length === 0 && <li className={styles.empty}>empty</li>}
            </ul>
          </section>
        )
      })}
      {error && <p className="offline">{error}</p>}
    </div>
  )
}
