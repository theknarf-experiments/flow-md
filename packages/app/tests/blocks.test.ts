import { describe, expect, it } from 'vitest'
import { frontmatterRange, frontmatterSummary } from '../src/lib/blocks.js'

const NOTE = ['---', 'title: X', 'tags: [a]', '---', '# Head', '', 'one'].join('\n')

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
