// Tiny deterministic force layout for the connected-notes graph. No deps:
// golden-angle initial placement (stable across runs — no randomness, which
// also keeps re-renders calm), then a fixed number of ticks of repulsion +
// edge springs + mild centering. Pure, so it's unit-testable.

export interface GraphNode {
  id: string
  x: number
  y: number
  /** Degree (edge count), for sizing. */
  degree: number
}

export interface GraphEdge {
  from: string
  to: string
}

export interface GraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width: number
  height: number
}

export function layoutGraph(
  edges: readonly GraphEdge[],
  extraNodes: readonly string[] = [],
  width = 640,
  height = 420,
  ticks = 150,
): GraphLayout {
  const ids = new Set<string>(extraNodes)
  for (const e of edges) {
    ids.add(e.from)
    ids.add(e.to)
  }
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  // Golden-angle spiral: deterministic, reasonably spread.
  const nodes: GraphNode[] = [...ids].sort().map((id, i) => {
    const angle = i * 2.39996
    const radius = 16 * Math.sqrt(i + 1)
    return {
      id,
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
      degree: degree.get(id) ?? 0,
    }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const REPULSION = 5200
  const SPRING = 0.04
  const SPRING_LEN = 90
  const CENTER = 0.012
  for (let t = 0; t < ticks; t++) {
    const cool = 1 - t / ticks
    for (const a of nodes) {
      let fx = 0
      let fy = 0
      for (const b of nodes) {
        if (a === b) continue
        const dx = a.x - b.x
        const dy = a.y - b.y
        const d2 = Math.max(dx * dx + dy * dy, 64)
        const f = REPULSION / d2
        const d = Math.sqrt(d2)
        fx += (dx / d) * f
        fy += (dy / d) * f
      }
      fx += (width / 2 - a.x) * CENTER
      fy += (height / 2 - a.y) * CENTER
      a.x += fx * cool
      a.y += fy * cool
    }
    for (const e of edges) {
      const a = byId.get(e.from)!
      const b = byId.get(e.to)!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const f = (d - SPRING_LEN) * SPRING * cool
      const ux = dx / d
      const uy = dy / d
      a.x += ux * f
      a.y += uy * f
      b.x -= ux * f
      b.y -= uy * f
    }
    // Keep everything on the canvas.
    for (const n of nodes) {
      n.x = Math.min(Math.max(n.x, 24), width - 24)
      n.y = Math.min(Math.max(n.y, 18), height - 18)
    }
  }

  return { nodes, edges: [...edges], width, height }
}
