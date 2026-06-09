import type { Link, Paragraph, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { remarkWikiLinks, resolveWikiTarget } from '../src/lib/wiki.js'

function parse(md: string): Root {
  const processor = unified().use(remarkParse).use(remarkWikiLinks)
  return processor.runSync(processor.parse(md)) as Root
}

function links(tree: Root): Link[] {
  const para = tree.children[0] as Paragraph
  return para.children.filter((c): c is Link => c.type === 'link')
}

describe('remarkWikiLinks', () => {
  it('turns [[Target]] into a wiki: link, keeping surrounding text', () => {
    const tree = parse('before [[Other Note]] after')
    const para = tree.children[0] as Paragraph
    expect(para.children.map((c) => c.type)).toEqual(['text', 'link', 'text'])
    const link = links(tree)[0]!
    expect(link.url).toBe('wiki:Other Note')
  })

  it('honors [[target|label]] aliases and #heading suffixes', () => {
    const aliased = links(parse('[[notes/x|fancy name]]'))[0]!
    expect(aliased.url).toBe('wiki:notes/x')
    expect(aliased.children[0]).toMatchObject({ value: 'fancy name' })

    const heading = links(parse('[[Other#section]]'))[0]!
    expect(heading.url).toBe('wiki:Other')
  })

  it('handles several links in one text node', () => {
    expect(links(parse('[[a]] and [[b]]'))).toHaveLength(2)
  })
})

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
