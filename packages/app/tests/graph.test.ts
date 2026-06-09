import { describe, expect, it } from 'vitest'
import { layoutGraph } from '../src/lib/graph.js'

const EDGES = [
  { from: 'a.md', to: 'b.md' },
  { from: 'a.md', to: 'c.md' },
  { from: 'b.md', to: 'c.md' },
]

describe('layoutGraph', () => {
  it('collects nodes from edges plus extras, with degrees', () => {
    const g = layoutGraph(EDGES, ['lonely.md'])
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      'a.md',
      'b.md',
      'c.md',
      'lonely.md',
    ])
    expect(g.nodes.find((n) => n.id === 'a.md')!.degree).toBe(2)
    expect(g.nodes.find((n) => n.id === 'lonely.md')!.degree).toBe(0)
  })

  it('keeps every node inside the canvas', () => {
    const g = layoutGraph(EDGES)
    for (const n of g.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(g.width)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeLessThanOrEqual(g.height)
    }
  })

  it('is deterministic', () => {
    expect(layoutGraph(EDGES)).toEqual(layoutGraph(EDGES))
  })

  it('separates connected nodes to roughly the spring length', () => {
    const g = layoutGraph([{ from: 'x', to: 'y' }])
    const [a, b] = g.nodes
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
    expect(d).toBeGreaterThan(30)
  })
})
