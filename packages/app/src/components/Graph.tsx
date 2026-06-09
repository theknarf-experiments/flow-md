// Obsidian-style connected-notes graph, driven by a Datalog query:
//
//   <Graph />                                 (vault link graph)
//   <Graph query="CoTagged(a, b, _)" from="a" to="b" />
//
// Any query works as long as `from`/`to` name two of its columns — the graph
// is just a view over edge tuples, so rules can derive arbitrary
// relationship graphs (co-tagged pages, folder adjacency, ...). Nodes that
// resolve to vault files navigate on click; unresolved targets render dimmed
// (the Obsidian "ghost note" affordance).

import { useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { notesCollection } from '../lib/db.js'
import { type GraphEdge, layoutGraph } from '../lib/graph.js'
import { usePoll } from '../lib/usePoll.js'
import { resolveWikiTarget } from '../lib/wiki.js'
import styles from './Graph.module.css'

export function Graph(props: { query?: string; from?: string; to?: string }) {
  const query = props.query ?? 'Link(src, dst, kind)'
  const fromVar = props.from ?? 'src'
  const toVar = props.to ?? 'dst'
  const result = usePoll(() => api.run(query), [query], 5000)
  const { data: notes } = useLiveQuery((q) => q.from({ note: notesCollection }))
  const navigate = useNavigate()
  const [hover, setHover] = useState<string | null>(null)

  const files = useMemo(() => (notes ?? []).map((n) => n.path), [notes])

  const layout = useMemo(() => {
    const columns = result.data?.columns ?? []
    const fi = columns.indexOf(fromVar)
    const ti = columns.indexOf(toVar)
    if (fi < 0 || ti < 0) return null
    const edges: GraphEdge[] = []
    const seen = new Set<string>()
    for (const row of result.data?.rows ?? []) {
      const from = String(row[fi])
      const to = String(row[ti])
      const key = `${from}${to}`
      if (from === to || seen.has(key)) continue
      seen.add(key)
      edges.push({ from, to })
    }
    return layoutGraph(edges)
  }, [result.data, fromVar, toVar])

  if (result.error || result.data?.error) {
    return <p className="offline">graph: {result.error ?? result.data?.error}</p>
  }
  if (result.data && !layout) {
    return (
      <p className="offline">
        graph: query is missing column "{fromVar}" or "{toVar}"
      </p>
    )
  }
  if (!layout) return null

  const resolve = (id: string): string | null =>
    files.includes(id) ? id : resolveWikiTarget(id, files)

  const neighbours = new Set<string>()
  if (hover) {
    neighbours.add(hover)
    for (const e of layout.edges) {
      if (e.from === hover) neighbours.add(e.to)
      if (e.to === hover) neighbours.add(e.from)
    }
  }

  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  return (
    <figure className={styles.wrap} data-testid="graph">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className={styles.svg}
        role="img"
        aria-label="connected notes graph"
      >
        {layout.edges.map((e) => {
          const a = byId.get(e.from)!
          const b = byId.get(e.to)!
          const dim = hover !== null && !(neighbours.has(e.from) && neighbours.has(e.to))
          return (
            <line
              key={`${e.from}->${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={dim ? styles.edgeDim : styles.edge}
            />
          )
        })}
        {layout.nodes.map((n) => {
          const target = resolve(n.id)
          const dim = hover !== null && !neighbours.has(n.id)
          return (
            <g
              key={n.id}
              className={`${styles.node} ${dim ? styles.nodeDim : ''} ${target ? '' : styles.ghost}`}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                if (target) void navigate({ to: '/note/$', params: { _splat: target } })
              }}
            >
              <circle cx={n.x} cy={n.y} r={4 + Math.min(n.degree, 6)} />
              <text x={n.x} y={n.y - (8 + Math.min(n.degree, 6))}>
                {n.id.split('/').at(-1)}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className={styles.caption}>
        <code>{query}</code> — {layout.nodes.length} notes,{' '}
        {layout.edges.length} links
      </figcaption>
    </figure>
  )
}
