import { describe, expect, it } from 'vitest'
import { type Fact, parseMarkdown } from '../src/markdown.js'

const SAMPLE = `---
title: My Note
tags: [project, urgent]
status: active
---

# Heading One

Some prose with a #inline tag, a [[Wiki Target]] link, a
[[Aliased|shown text]] link, and a [markdown link](https://example.com).

## Heading Two

\`\`\`datalog
Important(p) :- Tag(p, "urgent").
\`\`\`

\`\`\`datalog-query
Important(p)
\`\`\`

\`\`\`js
console.log("not datalog")
\`\`\`
`

function rows(facts: Fact[], rel: string): unknown[][] {
  return facts
    .filter((f) => f.rel === rel)
    .map((f) => f.row)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

describe('parseMarkdown', () => {
  const parsed = parseMarkdown('notes/my-note.md', SAMPLE, 1716000000000)

  it('emits a File fact with path and mtime', () => {
    expect(rows(parsed.facts, 'File')).toEqual([
      ['notes/my-note.md', 1716000000000],
    ])
  })

  it('emits headings with level, text and line', () => {
    const headings = rows(parsed.facts, 'Heading')
    expect(headings).toContainEqual(['notes/my-note.md', 1, 'Heading One', 7])
    expect(headings).toContainEqual(['notes/my-note.md', 2, 'Heading Two', 12])
  })

  it('captures frontmatter, including array values', () => {
    const fm = rows(parsed.facts, 'Frontmatter')
    expect(fm).toContainEqual(['notes/my-note.md', 'title', 'My Note'])
    expect(fm).toContainEqual(['notes/my-note.md', 'status', 'active'])
    expect(fm).toContainEqual(['notes/my-note.md', 'tags', 'project'])
    expect(fm).toContainEqual(['notes/my-note.md', 'tags', 'urgent'])
  })

  it('derives tags from both frontmatter and inline #tags', () => {
    const tags = rows(parsed.facts, 'Tag')
    expect(tags).toContainEqual(['notes/my-note.md', 'project'])
    expect(tags).toContainEqual(['notes/my-note.md', 'urgent'])
    expect(tags).toContainEqual(['notes/my-note.md', 'inline'])
  })

  it('captures wiki-links (stripping aliases) and markdown links', () => {
    const links = rows(parsed.facts, 'Link')
    expect(links).toContainEqual(['notes/my-note.md', 'Wiki Target', 'wiki'])
    expect(links).toContainEqual(['notes/my-note.md', 'Aliased', 'wiki'])
    expect(links).toContainEqual([
      'notes/my-note.md',
      'https://example.com',
      'md',
    ])
  })

  it('routes code blocks: datalog→rules, datalog-query→queries, else→fact', () => {
    expect(parsed.rules).toEqual(['Important(p) :- Tag(p, "urgent").'])
    expect(parsed.queries).toEqual([{ line: 18, source: 'Important(p)' }])
    expect(rows(parsed.facts, 'CodeBlock')).toEqual([
      ['notes/my-note.md', 'js', 22],
    ])
  })
})
