import { describe, expect, it } from 'vitest'
import { buildTree } from '../src/lib/tree.js'

describe('buildTree', () => {
  it('nests directories and sorts dirs before files', () => {
    const tree = buildTree(['b.md', 'a/inner.md', 'a/z.md', 'a/sub/deep.md'])
    expect(tree.map((n) => n.name)).toEqual(['a', 'b.md'])
    const a = tree[0]!
    expect(a.children!.map((n) => n.name)).toEqual(['sub', 'inner.md', 'z.md'])
    expect(a.children![0]!.children![0]!.path).toBe('a/sub/deep.md')
  })

  it('handles an empty vault', () => {
    expect(buildTree([])).toEqual([])
  })

  it('keeps full paths on every node', () => {
    const tree = buildTree(['docs/x.md'])
    expect(tree[0]!.path).toBe('docs')
    expect(tree[0]!.children![0]!.path).toBe('docs/x.md')
  })
})
