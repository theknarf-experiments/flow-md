import { describe, expect, it } from 'vitest'
import {
  APPEND,
  frontmatterRange,
  frontmatterSummary,
  insertBlock,
  replaceLines,
  sliceLines,
  unwrapFlow,
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

describe('unwrapFlow', () => {
  it('joins hard-wrapped source lines into one logical line', () => {
    expect(unwrapFlow('one two\nthree four\nfive')).toBe('one two three four five')
  })

  it('preserves GFM hard breaks (trailing two spaces / backslash)', () => {
    expect(unwrapFlow('line one  \nline two')).toBe('line one  \nline two')
    expect(unwrapFlow('line one\\\nline two')).toBe('line one\\\nline two')
  })

  it('leaves blank-line separations alone', () => {
    expect(unwrapFlow('a\n\nb')).toBe('a\n\nb')
  })

  it('is a no-op on single lines', () => {
    expect(unwrapFlow('just one line')).toBe('just one line')
  })
})

describe('insertBlock', () => {
  it('pads with blank lines against non-empty neighbours', () => {
    const { content, range } = insertBlock('para one\npara two', 1, 'inserted')
    expect(content).toBe('para one\n\ninserted\n\npara two')
    expect(range).toEqual({ start: 3, end: 3 })
  })

  it('skips padding when neighbours are already blank', () => {
    const { content, range } = insertBlock('a\n\nb', 2, 'mid')
    expect(content).toBe('a\n\nmid\n\nb')
    expect(range).toEqual({ start: 3, end: 3 })
  })

  it('inserts at the very top and bottom', () => {
    expect(insertBlock('body', 0, 'top').content).toBe('top\n\nbody')
    const tail = insertBlock('body\n', 2, 'tail')
    expect(tail.content).toBe('body\n\ntail')
  })

  it('reports multi-line ranges so editing can continue from them', () => {
    const { range } = insertBlock('a\n\nb', 2, 'x\ny')
    expect(range).toEqual({ start: 3, end: 4 })
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
