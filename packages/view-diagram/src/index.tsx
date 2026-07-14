// Datalog-driven modular-svg diagrams — a flow-md view plugin. In an MDX
// note, <Diagram> runs a query and hands the rows (as objects keyed by the
// query's columns) to its function child, which returns a modular-svg scene;
// the scene is solved and rendered as SVG:
//
//   <Diagram query="Task(path, status, text, line)">
//     {({ rows }) => (
//       <stackH spacing={24}>
//         {['open', 'closed'].map((s) => (
//           <stackV key={s} spacing={8}>
//             <rect width={40} height={14 + rows.filter((r) => r.status === s).length * 18} />
//             <text>{s}</text>
//           </stackV>
//         ))}
//       </stackH>
//     )}
//   </Diagram>
//
// The lowercase tags (stackH, stackV, align, distribute, background, arrow,
// ref, rect, circle, text, …) are modular-svg scene primitives — converted
// to the core JSON format by a static element traversal (see scene.ts),
// solved by @modular-svg/core's fixed-point layout solver, and emitted as
// SVG. <Graphic> renders a static scene without a query. Because Diagram's
// data is a live query, the diagram re-solves as the vault changes.
//
// A render boundary contains mistakes in the note's diagram code (it's
// arbitrary JS) to the diagram box instead of taking down the whole editor.

import { type FlowMdViewPlugin, useFlowMd } from '@flow-md/view-api'
import { buildSceneFromJson, layoutToSvg, solveLayout } from '@modular-svg/core'
import { Component, type ReactNode, useMemo } from 'react'
import { type Row, rowsAsObjects } from './rows.js'
import { childrenToScene } from './scene.js'

export interface DiagramData {
  columns: string[]
  rows: Row[]
}

/** Render a static modular-svg scene (no query). */
export function Graphic(props: {
  children?: ReactNode
  margin?: number | string
  title?: string
}) {
  const { children, margin, title } = props
  const result = useMemo(() => {
    try {
      const json = childrenToScene(children)
      if (!json) return { svg: null, error: null }
      const scene = buildSceneFromJson(json)
      const layout = solveLayout(scene)
      return {
        svg: layoutToSvg(layout, scene.nodes, Number(margin ?? 10)),
        error: null,
      }
    } catch (err) {
      return {
        svg: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [children, margin])
  if (result.error) return <p className="offline">diagram: {result.error}</p>
  const svg = result.svg
  if (!svg) return null
  return (
    <figure
      data-testid="diagram"
      {...(title !== undefined ? { 'aria-label': title } : {})}
      // The SVG string comes from modular-svg's own serializer over numeric
      // layout results — same trust model as evaluating the note's MDX.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: see above
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ margin: 0 }}
    />
  )
}

export function Diagram(props: {
  query: string
  margin?: number | string
  title?: string
  children?: ReactNode | ((data: DiagramData) => ReactNode)
}) {
  const host = useFlowMd()
  const state = host.useQuery(props.query, { intervalMs: 3000 })

  if (state.error) return <p className="offline">diagram: {state.error}</p>
  if (!state.ready) return null

  const children =
    typeof props.children === 'function'
      ? props.children({
          columns: state.columns,
          rows: rowsAsObjects(state.columns, state.rows),
        })
      : props.children

  return (
    <DiagramBoundary>
      <Graphic
        {...(props.margin !== undefined ? { margin: props.margin } : {})}
        {...(props.title !== undefined ? { title: props.title } : {})}
      >
        {children}
      </Graphic>
    </DiagramBoundary>
  )
}

class DiagramBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  override state = { error: null as string | null }

  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  override render() {
    if (this.state.error) {
      return <p className="offline">diagram error: {this.state.error}</p>
    }
    return this.props.children
  }
}

export const diagramPlugin: FlowMdViewPlugin = {
  name: 'diagram',
  components: { Diagram, Graphic },
}

export default diagramPlugin
export { rowsAsObjects } from './rows.js'
export type { Row } from './rows.js'
export { childrenToScene } from './scene.js'
export type { SceneJson } from './scene.js'
