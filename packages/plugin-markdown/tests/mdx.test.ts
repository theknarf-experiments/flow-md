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
    expect(parsed.facts).toContainEqual({
      rel: 'Heading',
      row: ['board.mdx', 1, 'Board', 1],
    })
    expect(parsed.facts).toContainEqual({
      rel: 'Task',
      row: ['board.mdx', 'open', 'try mdx', 5],
    })
    expect(parsed.facts).toContainEqual({
      rel: 'Link',
      row: ['board.mdx', 'wiki link', 'wiki'],
    })
    expect(parsed.facts).toContainEqual({ rel: 'Tag', row: ['board.mdx', 'atag'] })
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
