import { describe, expect, it } from 'vitest'
import { scanJsxBlocks } from '../src/components/editor/jsx.js'

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
