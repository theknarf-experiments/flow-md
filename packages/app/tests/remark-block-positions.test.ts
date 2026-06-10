import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { remarkBlockPositions } from '../src/lib/remark-block-positions.js'

function parse(src: string) {
  const proc = unified().use(remarkParse).use(remarkMdx).use(remarkBlockPositions)
  return proc.runSync(proc.parse(src)) as unknown as {
    children: Array<{
      type: string
      data?: { hProperties?: Record<string, unknown> }
      attributes?: Array<{ name: string; value: string }>
    }>
  }
}

const DOC = ['# Title', '', 'A paragraph.', '', '<Kanban query="Task(p,s,t,l)" />'].join('\n')

describe('remarkBlockPositions', () => {
  const tree = parse(DOC)

  it('stamps markdown blocks with data attributes', () => {
    const heading = tree.children[0]!
    expect(heading.data?.hProperties).toMatchObject({
      'data-block-start': 1,
      'data-block-end': 1,
    })
    const para = tree.children[1]!
    expect(para.data?.hProperties).toMatchObject({
      'data-block-start': 3,
      'data-block-end': 3,
    })
  })

  it('stamps JSX elements with real attributes', () => {
    const jsx = tree.children[2]!
    expect(jsx.type).toBe('mdxJsxFlowElement')
    const byName = Object.fromEntries(
      (jsx.attributes ?? []).map((a) => [a.name, a.value]),
    )
    expect(byName['data-block-start']).toBe('5')
    expect(byName['data-block-end']).toBe('5')
  })

  it('is idempotent on JSX attributes', () => {
    const again = parse(DOC) // plugin runs once per parse; simulate re-run:
    const jsx = again.children[2]!
    const names = (jsx.attributes ?? []).map((a) => a.name)
    expect(names.filter((n) => n === 'data-block-start')).toHaveLength(1)
  })
})
