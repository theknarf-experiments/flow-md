import { describe, expect, it } from 'vitest'
import {
  APPEND,
  frontmatterRange,
  frontmatterSummary,
  replaceLines,
  sliceLines,
} from '../src/lib/blocks.js'

const NOTE = ['---', 'title: X', 'tags: [a]', '---', '# Head', '', 'one', 'two', ''].join('\n')

describe('sliceLines / replaceLines', () => {
  it('slices a 1-based inclusive range', () => {
    expect(sliceLines(NOTE, { start: 7, end: 8 })).toBe('one\ntwo')
    expect(sliceLines(NOTE, { start: 5, end: 5 })).toBe('# Head')
  })

  it('replaces a block in place', () => {
    const next = replaceLines(NOTE, { start: 7, end: 8 }, 'three')
    expect(next.split('\n').slice(6, 8)).toEqual(['three', ''])
    expect(next).toContain('# Head')
  })

  it('grows and shrinks line counts', () => {
    const grown = replaceLines('a\nb\nc', { start: 2, end: 2 }, 'x\ny')
    expect(grown).toBe('a\nx\ny\nc')
    const removed = replaceLines('a\nb\nc', { start: 2, end: 2 }, '')
    expect(removed).toBe('a\nc')
  })

  it('appends with a separating blank line and trailing newline', () => {
    expect(replaceLines('a\n', APPEND, 'new block')).toBe('a\n\nnew block\n')
    expect(replaceLines('a', APPEND, '')).toBe('a\n')
  })

  it('round-trips: slice then replace with itself is identity', () => {
    const range = { start: 5, end: 5 }
    expect(replaceLines(NOTE, range, sliceLines(NOTE, range))).toBe(NOTE)
  })
})

describe('frontmatter', () => {
  it('finds the fenced block and summarises its keys', () => {
    const range = frontmatterRange(NOTE)
    expect(range).toEqual({ start: 1, end: 4 })
    expect(frontmatterSummary(NOTE, range!)).toBe('title, tags')
  })

  it('returns null without frontmatter or an unterminated fence', () => {
    expect(frontmatterRange('# Hi')).toBeNull()
    expect(frontmatterRange('---\ntitle: x')).toBeNull()
  })
})
