import { describe, expect, it } from 'vitest'
import { findJsxSpans, scanJsxBlocks } from '../src/components/editor/jsx.js'

describe('scanJsxBlocks', () => {
  it('finds single-line self-closing components', () => {
    const text = 'before\n\n<Graph />\n\nafter'
    const spans = scanJsxBlocks(text)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.source).toBe('<Graph />')
  })

  it('finds multi-line components (not valid CommonMark HTML blocks)', () => {
    const text = ['# Title', '', '<Kanban', '  query="Task(p,s,t,l)"', '  groupBy="s"', '/>', '', 'tail'].join('\n')
    const spans = scanJsxBlocks(text)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.source).toBe('<Kanban\n  query="Task(p,s,t,l)"\n  groupBy="s"\n/>')
  })

  it('finds paired tags with children', () => {
    const text = '<Card>\nsome **markdown** child\n</Card>'
    const spans = scanJsxBlocks(text)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.source).toBe(text)
  })

  it('ignores lowercase html, unterminated opens, and skip ranges', () => {
    expect(scanJsxBlocks('<div>\nhtml\n</div>')).toHaveLength(0)
    expect(scanJsxBlocks('<Broken\n  never closes')).toHaveLength(0)
    const fenced = '```jsx\n<Kanban />\n```'
    expect(scanJsxBlocks(fenced, [{ from: 0, to: fenced.length }])).toHaveLength(0)
  })

  it('finds several blocks', () => {
    const text = '<Graph />\n\ntext\n\n<Kanban query="x" />'
    expect(scanJsxBlocks(text)).toHaveLength(2)
  })
})

describe('findJsxSpans (MDX-grammar scan)', () => {
  it('handles nested self-closing children (the <ref/> case)', () => {
    const text = [
      '# Doc',
      '',
      '<Graphic margin={12}>',
      '  <rect key="a" width={4} />',
      '  <arrow>',
      '    <ref target="a" />',
      '  </arrow>',
      '</Graphic>',
      '',
      'after',
    ].join('\n')
    const spans = findJsxSpans(text)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.source.startsWith('<Graphic')).toBe(true)
    expect(spans[0]!.source.endsWith('</Graphic>')).toBe(true)
  })

  it('handles arrow-function expression children with =>', () => {
    const text = [
      '<Diagram query="Task(p, s, t, l)">',
      '  {({ rows }) => (',
      '    <stackH spacing={8}>',
      '      <rect',
      '        width={40}',
      '      />',
      '    </stackH>',
      '  )}',
      '</Diagram>',
    ].join('\n')
    const spans = findJsxSpans(text)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.source.endsWith('</Diagram>')).toBe(true)
  })

  it('ignores fenced examples and lowercase html', () => {
    const text = '```jsx\n<Kanban />\n```\n\n<div>html</div>'
    expect(findJsxSpans(text)).toHaveLength(0)
  })

  it('falls back to the line scanner on broken MDX', () => {
    // `{` opens an unclosed expression → remark-mdx throws.
    const text = 'broken {expr\n\n<Graph />'
    const spans = findJsxSpans(text)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.source).toBe('<Graph />')
  })
})
