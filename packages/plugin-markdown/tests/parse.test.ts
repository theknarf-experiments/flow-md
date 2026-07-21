import type { Fact } from '@flow-md/plugin-api'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../src/parse.js'

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

  it('emits every node of the tree, with its parent and extent', () => {
    // Emission order is document order, so the root comes first and every
    // node names the one that contains it.
    const nodes = parsed.facts.filter((f) => f.rel === 'MdNode').map((f) => f.row)
    expect(nodes[0]!.slice(0, 4)).toEqual(['notes/my-note.md', 0, -1, 'root'])
    expect(nodes.map((r) => r[3])).toContain('heading')
    expect(nodes.map((r) => r[3])).toContain('link')
    const link = nodes.find((r) => r[3] === 'link')!
    const parent = nodes.find((r) => r[1] === link[2])!
    expect(parent[3]).toBe('paragraph')
  })

  it('emits a heading as a node with a depth and its text', () => {
    const nodes = parsed.facts.filter((f) => f.rel === 'MdNode').map((f) => f.row)
    const texts = parsed.facts.filter((f) => f.rel === 'MdNodeText').map((f) => f.row)
    const headings = nodes.filter((r) => r[3] === 'heading')
    const depths = rows(parsed.facts, 'MdPropNum')
    const textOf = (id: unknown) => texts.find((r) => r[1] === id)![2]

    expect(headings).toHaveLength(2)
    expect(textOf(headings[0]![1])).toBe('Heading One')
    expect(depths).toContainEqual(['notes/my-note.md', headings[0]![1], 'depth', 1])
    expect(textOf(headings[1]![1])).toBe('Heading Two')
    expect(depths).toContainEqual(['notes/my-note.md', headings[1]![1], 'depth', 2])
  })

  it('captures frontmatter, including array values', () => {
    const fm = rows(parsed.facts, 'Frontmatter')
    expect(fm).toContainEqual(['notes/my-note.md', 'title', 'My Note'])
    expect(fm).toContainEqual(['notes/my-note.md', 'status', 'active'])
    expect(fm).toContainEqual(['notes/my-note.md', 'tags', 'project'])
    expect(fm).toContainEqual(['notes/my-note.md', 'tags', 'urgent'])
  })

  it('scrapes inline #tags, leaving frontmatter ones to a rule', () => {
    // Tag(path, tag) is a view: it unions these with the `tags:` key below.
    const tags = rows(parsed.facts, 'MdInlineTag')
    expect(tags.map((r) => r[1])).toContain('inline')
    expect(rows(parsed.facts, 'Frontmatter')).toContainEqual([
      'notes/my-note.md',
      'tags',
      'project',
    ])
  })

  it('captures wiki-links with their alias, and links as nodes', () => {
    const wiki = rows(parsed.facts, 'MdWikiLink')
    expect(wiki.map((r) => r.slice(1, 3))).toContainEqual(['Wiki Target', 'Wiki Target'])
    expect(wiki.map((r) => r.slice(1, 3))).toContainEqual(['Aliased', 'shown text'])
    // A markdown link is a node; its url is a property of it.
    const link = rows(parsed.facts, 'MdNode').find((r) => r[3] === 'link')!
    expect(rows(parsed.facts, 'MdProp')).toContainEqual([
      'notes/my-note.md',
      link[1],
      'url',
      'https://example.com',
    ])
  })

  it('routes code blocks: datalog→rules, datalog-query→queries, else→node', () => {
    expect(parsed.rules).toEqual(['Important(p) :- Tag(p, "urgent").'])
    expect(parsed.queries).toEqual([{ line: 18, source: 'Important(p)' }])
    // Every fence is a node, including the two that feed the engine; the
    // CodeBlock view is the one that filters those out.
    const langs = rows(parsed.facts, 'MdProp')
      .filter((r) => r[2] === 'lang')
      .map((r) => r[3])
    expect(langs).toEqual(['datalog', 'datalog-query', 'js'])
  })

  it('emits typed FrontmatterNumber facts for numeric values', () => {
    const numeric = [
      '---',
      'priority: 3',
      'weight: 1.5',
      'order: 10',
      'title: My Note',
      'version: "2"',
      '---',
      '# H',
    ].join('\n')
    const p = parseMarkdown('n.md', numeric, 1)

    expect(rows(p.facts, 'FrontmatterNumber')).toEqual([
      ['n.md', 'order', 10],
      ['n.md', 'priority', 3],
      ['n.md', 'weight', 1.5],
    ])
    // Strings (incl. quoted "2") are not numeric facts...
    expect(rows(p.facts, 'FrontmatterNumber')).not.toContainEqual([
      'n.md',
      'version',
      2,
    ])
    // ...but every key, numeric or not, still appears as a string Frontmatter fact.
    const fm = rows(p.facts, 'Frontmatter')
    expect(fm).toContainEqual(['n.md', 'priority', '3'])
    expect(fm).toContainEqual(['n.md', 'version', '2'])
    expect(fm).toContainEqual(['n.md', 'title', 'My Note'])
  })

  it('marks a checkbox item with a status, in the words the Task view uses', () => {
    const sample = [
      '# Todos',
      '',
      '- [ ] write the parser',
      '- [x] ship the spike',
      '- a normal bullet, not a task',
    ].join('\n')
    const facts = parseMarkdown('todo.md', sample, 1).facts
    const statuses = facts
      .filter((f) => f.rel === 'MdProp' && f.row[2] === 'status')
      .map((f) => f.row[3])
    // The plain bullet has no checkbox, so it has no status — and so it will
    // not be a Task.
    expect(statuses).toEqual(['open', 'closed'])
  })

})
