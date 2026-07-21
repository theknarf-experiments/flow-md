import { describe, expect, it } from 'vitest'
import { parseMdx } from '../src/parse.js'

function md(...lines: string[]): string {
  return lines.join('\n')
}

const DOC = md(
  '# Board', //                                line 1
  '',
  '<Kanban query="Task(p, s, t, l)" groupBy="s" />',
  '',
  '- [ ] try mdx', //                          line 5
  '',
  'A [[wiki link]] and #atag.',
  '',
  '```datalog-query',
  'Task(path, status, text, line)',
  '```',
)

describe('parseMdx', () => {
  const parsed = parseMdx('board.mdx', DOC, 1)

  it('extracts the same fact kinds as markdown', () => {
    const nodes = parsed.facts.filter((f) => f.rel === 'MdNode')
    expect(nodes.map((f) => f.row[3])).toContain('heading')
    const wiki = parsed.facts.find((f) => f.rel === 'MdNode' && f.row[3] === 'wikiLink')!
    expect(
      parsed.facts.some(
        (f) => f.rel === 'MdProp' && f.row[1] === wiki.row[1] && f.row[3] === 'wiki link',
      ),
    ).toBe(true)
    expect(parsed.facts.some((f) => f.rel === 'MdInlineTag' && f.row[1] === 'atag')).toBe(
      true,
    )
  })

  it('collects query blocks with their fence line', () => {
    expect(parsed.queries).toEqual([
      { line: 9, source: 'Task(path, status, text, line)' },
    ])
  })

  it('degrades to a File-only result on malformed JSX', () => {
    const broken = parseMdx('bad.mdx', '# Hi\n\n<Unclosed', 3)
    expect(broken.facts).toEqual([{ rel: 'File', row: ['bad.mdx', 3] }])
    expect(broken.queries).toEqual([])
  })
})
