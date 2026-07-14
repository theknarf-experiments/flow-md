import { createElement as h, Fragment } from 'react'
import { describe, expect, it } from 'vitest'
import { childrenToScene } from '../src/scene.js'

describe('childrenToScene', () => {
  it('mirrors the reconciler mapping: capitalized types, props, children', () => {
    const json = childrenToScene(
      h('stackH', { spacing: 10 }, h('circle', { r: 15, fill: 'red' }), h('rect', { width: 4 })),
    )
    expect(json).toEqual({
      type: 'StackH',
      props: { spacing: 10 },
      children: [
        { type: 'Circle', props: { r: 15, fill: 'red' }, children: [] },
        { type: 'Rect', props: { width: 4 }, children: [] },
      ],
    })
  })

  it('keeps element keys (arrow targets) and flattens refs', () => {
    const json = childrenToScene([
      h('rect', { key: 'a', width: 40, height: 30 }),
      h('arrow', { key: 'arr' }, h('ref', { target: 'a' }), h('ref', { target: 'b' })),
    ])
    expect(json).toEqual({
      type: 'Group',
      props: {},
      children: [
        { type: 'Rect', key: 'a', props: { width: 40, height: 30 }, children: [] },
        {
          type: 'Arrow',
          key: 'arr',
          props: {},
          children: [
            { type: 'Ref', target: 'a' },
            { type: 'Ref', target: 'b' },
          ],
        },
      ],
    })
  })

  it('joins text children into props.text and unwraps fragments', () => {
    const json = childrenToScene(
      h(Fragment, null, h('text', null, 'open: ', 5)),
    )
    expect(json).toEqual({
      type: 'Text',
      props: { text: 'open: 5' },
      children: [],
    })
  })

  it('ignores null/boolean children, rejects components', () => {
    expect(childrenToScene([null, false, undefined])).toBeNull()
    const Comp = () => null
    expect(() => childrenToScene(h(Comp))).toThrow(/primitive tags/)
  })
})

describe('end to end through @modular-svg/core', async () => {
  // Type-level imports are shimmed (tsconfig paths); at runtime vitest
  // resolves the real vendored package.
  const { buildSceneFromJson, layoutToSvg, solveLayout } = await import(
    '@modular-svg/core'
  )

  it('a traversed scene solves and serializes to SVG', () => {
    const json = childrenToScene(
      h(
        'stackH',
        { spacing: 12 },
        h('rect', { key: 'a', width: 40, height: 30, fill: '#8b7ee8' }),
        h('rect', { key: 'b', width: 40, height: 50, fill: '#5e55a8' }),
      ),
    )!
    const scene = buildSceneFromJson(json)
    const layout = solveLayout(scene)
    const svg = layoutToSvg(layout, scene.nodes, 10)
    expect(svg).toContain('<svg')
    expect(svg).toContain('#8b7ee8')
    expect((svg.match(/<rect/g) ?? []).length).toBe(2)
  })
})
