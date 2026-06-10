import { describe, expect, it } from 'vitest'
import { resolveWikiTarget } from '../src/lib/wiki.js'

describe('resolveWikiTarget', () => {
  const files = ['index.md', 'docs/tasks.md', 'docs/sub/tasks.md', 'a/unique.md']

  it('resolves mdx targets too', () => {
    const withMdx = [...files, 'board.mdx']
    expect(resolveWikiTarget('board', withMdx)).toBe('board.mdx')
    expect(resolveWikiTarget('board.mdx', withMdx)).toBe('board.mdx')
  })

  it('prefers exact paths, with or without .md', () => {
    expect(resolveWikiTarget('index', files)).toBe('index.md')
    expect(resolveWikiTarget('docs/tasks.md', files)).toBe('docs/tasks.md')
  })

  it('falls back to a unique basename match', () => {
    expect(resolveWikiTarget('unique', files)).toBe('a/unique.md')
  })

  it('returns null for ambiguous or missing targets', () => {
    expect(resolveWikiTarget('tasks', files)).toBeNull()
    expect(resolveWikiTarget('nope', files)).toBeNull()
  })
})
