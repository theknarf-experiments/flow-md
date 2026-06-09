import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from '../src/lib/fuzzy.js'

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyScore('tks', 'docs/Tasks.md')).not.toBeNull()
    expect(fuzzyScore('xyz', 'docs/tasks.md')).toBeNull()
  })

  it('requires characters in order', () => {
    expect(fuzzyScore('ts', 'tasks')).not.toBeNull()
    expect(fuzzyScore('st', 'task')).toBeNull() // s never precedes t
  })

  it('scores consecutive and word-boundary matches higher', () => {
    const exact = fuzzyScore('tasks', 'docs/tasks.md')!
    const scattered = fuzzyScore('tasks', 'the-awful-sks.md')
    if (scattered !== null) expect(exact).toBeGreaterThan(scattered)

    const boundary = fuzzyScore('cal', 'docs/calendar.md')!
    const mid = fuzzyScore('cal', 'physical.md')!
    expect(boundary).toBeGreaterThan(mid)
  })

  it('empty query matches everything', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})

describe('fuzzyFilter', () => {
  const files = ['docs/tasks.md', 'docs/calendar.md', 'index.md', 'a/b/c.md']

  it('ranks the best match first and respects the limit', () => {
    const out = fuzzyFilter(files, 'tasks', (f) => f)
    expect(out[0]).toBe('docs/tasks.md')
    expect(fuzzyFilter(files, '', (f) => f, 2)).toHaveLength(2)
  })

  it('drops non-matches entirely', () => {
    expect(fuzzyFilter(files, 'zzz', (f) => f)).toEqual([])
  })
})
