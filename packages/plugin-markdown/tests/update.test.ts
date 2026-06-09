import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../src/parse.js'
import {
  deleteMarkdownFact,
  insertMarkdownFact,
  updateMarkdownFact,
} from '../src/update.js'

// Built from line arrays because a ``` fence inside a backtick template
// literal would terminate the template.
function md(...lines: string[]): string {
  return lines.join('\n')
}

const NOTE = md(
  '---',
  'title: My note',
  'priority: 2',
  'tags: [a, b]',
  '---',
  '# Top heading',
  '',
  'Some text with a #tag.',
  '',
  '- [ ] buy milk',
  '- [x] ship release',
  '- [ ] **bold** task',
)

/** A rewrite must stay consistent: reparsing the new content yields newFact
 *  and no longer yields oldFact. */
function roundTrip(content: string, oldFact: { rel: string; row: (string | number)[] }, newFact: { rel: string; row: (string | number)[] }): string {
  const updated = updateMarkdownFact(content, oldFact, newFact)
  const facts = parseMarkdown('n.md', updated, 0).facts
  const has = (f: typeof oldFact) =>
    facts.some((g) => g.rel === f.rel && JSON.stringify(g.row) === JSON.stringify(f.row))
  expect(has(newFact)).toBe(true)
  if (JSON.stringify(oldFact) !== JSON.stringify(newFact)) {
    expect(has(oldFact)).toBe(false)
  }
  return updated
}

describe('updateMarkdownFact: Task', () => {
  it('toggles open → closed', () => {
    const updated = roundTrip(
      NOTE,
      { rel: 'Task', row: ['n.md', 'open', 'buy milk', 10] },
      { rel: 'Task', row: ['n.md', 'closed', 'buy milk', 10] },
    )
    expect(updated.split('\n')[9]).toBe('- [x] buy milk')
  })

  it('toggles closed → open', () => {
    const updated = roundTrip(
      NOTE,
      { rel: 'Task', row: ['n.md', 'closed', 'ship release', 11] },
      { rel: 'Task', row: ['n.md', 'open', 'ship release', 11] },
    )
    expect(updated.split('\n')[10]).toBe('- [ ] ship release')
  })

  it('toggles a formatted task (text untouched)', () => {
    const updated = updateMarkdownFact(
      NOTE,
      { rel: 'Task', row: ['n.md', 'open', 'bold task', 12] },
      { rel: 'Task', row: ['n.md', 'closed', 'bold task', 12] },
    )
    expect(updated.split('\n')[11]).toBe('- [x] **bold** task')
  })

  it('rewrites plain task text', () => {
    const updated = roundTrip(
      NOTE,
      { rel: 'Task', row: ['n.md', 'open', 'buy milk', 10] },
      { rel: 'Task', row: ['n.md', 'open', 'buy oat milk', 10] },
    )
    expect(updated.split('\n')[9]).toBe('- [ ] buy oat milk')
  })

  it('rejects a text edit on a formatted task', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Task', row: ['n.md', 'open', 'bold task', 12] },
        { rel: 'Task', row: ['n.md', 'open', 'other', 12] },
      ),
    ).toThrow(/does not round-trip/)
  })

  it('rejects a stale status', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Task', row: ['n.md', 'closed', 'buy milk', 10] },
        { rel: 'Task', row: ['n.md', 'open', 'buy milk', 10] },
      ),
    ).toThrow(/is "open", not "closed"/)
  })

  it('rejects a line that is not a task', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Task', row: ['n.md', 'open', 'buy milk', 8] },
        { rel: 'Task', row: ['n.md', 'closed', 'buy milk', 8] },
      ),
    ).toThrow(/not a task-list item/)
  })

  it('rejects edits to non-writable columns', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Task', row: ['n.md', 'open', 'buy milk', 10] },
        { rel: 'Task', row: ['n.md', 'open', 'buy milk', 11] },
      ),
    ).toThrow(/"line" of Task is not writable/)
  })
})

describe('updateMarkdownFact: Heading', () => {
  it('rewrites heading text', () => {
    const updated = roundTrip(
      NOTE,
      { rel: 'Heading', row: ['n.md', 1, 'Top heading', 6] },
      { rel: 'Heading', row: ['n.md', 1, 'New title', 6] },
    )
    expect(updated.split('\n')[5]).toBe('# New title')
  })

  it('rejects a level mismatch', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Heading', row: ['n.md', 2, 'Top heading', 6] },
        { rel: 'Heading', row: ['n.md', 2, 'New', 6] },
      ),
    ).toThrow(/not a level-2 ATX heading/)
  })

  it('rejects heading text that would change structure', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Heading', row: ['n.md', 1, 'Top heading', 6] },
        { rel: 'Heading', row: ['n.md', 1, '# nope', 6] },
      ),
    ).toThrow(/not start with "#"/)
  })
})

describe('updateMarkdownFact: Frontmatter', () => {
  it('rewrites a string scalar', () => {
    const updated = roundTrip(
      NOTE,
      { rel: 'Frontmatter', row: ['n.md', 'title', 'My note'] },
      { rel: 'Frontmatter', row: ['n.md', 'title', 'Renamed note'] },
    )
    expect(updated.split('\n')[1]).toBe('title: Renamed note')
  })

  it('keeps numeric values unquoted so FrontmatterNumber survives', () => {
    const updated = roundTrip(
      NOTE,
      { rel: 'Frontmatter', row: ['n.md', 'priority', '2'] },
      { rel: 'Frontmatter', row: ['n.md', 'priority', '5'] },
    )
    expect(updated.split('\n')[2]).toBe('priority: 5')
    const facts = parseMarkdown('n.md', updated, 0).facts
    expect(facts).toContainEqual({
      rel: 'FrontmatterNumber',
      row: ['n.md', 'priority', 5],
    })
  })

  it('quotes values that would otherwise change YAML type', () => {
    const updated = updateMarkdownFact(
      NOTE,
      { rel: 'Frontmatter', row: ['n.md', 'title', 'My note'] },
      { rel: 'Frontmatter', row: ['n.md', 'title', 'null'] },
    )
    expect(updated.split('\n')[1]).toBe('title: "null"')
  })

  it('rejects list values', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Frontmatter', row: ['n.md', 'tags', 'a'] },
        { rel: 'Frontmatter', row: ['n.md', 'tags', 'c'] },
      ),
    ).toThrow(/not a single-line scalar/)
  })

  it('rejects a stale value', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Frontmatter', row: ['n.md', 'title', 'Old title'] },
        { rel: 'Frontmatter', row: ['n.md', 'title', 'New'] },
      ),
    ).toThrow(/is "My note", not "Old title"/)
  })
})

describe('deleteMarkdownFact', () => {
  it('removes the task line', () => {
    const updated = deleteMarkdownFact(NOTE, {
      rel: 'Task',
      row: ['n.md', 'open', 'buy milk', 10],
    })
    expect(updated.split('\n')).toHaveLength(NOTE.split('\n').length - 1)
    expect(updated).not.toContain('buy milk')
    expect(updated).toContain('- [x] ship release')
  })

  it('takes nested sub-items with it', () => {
    const nested = md('- [ ] parent', '  - [ ] child', '  notes', '- [ ] sibling')
    const updated = deleteMarkdownFact(nested, {
      rel: 'Task',
      row: ['n.md', 'open', 'parent', 1],
    })
    expect(updated).toBe('- [ ] sibling')
  })

  it('rejects a stale status and non-task lines', () => {
    expect(() =>
      deleteMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'closed', 'buy milk', 10] }),
    ).toThrow(/is "open", not "closed"/)
    expect(() =>
      deleteMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'open', 'x', 6] }),
    ).toThrow(/not a task-list item/)
    expect(() =>
      deleteMarkdownFact(NOTE, { rel: 'Heading', row: ['n.md', 1, 'Top heading', 6] }),
    ).toThrow(/not deletable/)
  })
})

describe('insertMarkdownFact', () => {
  it('appends at the end when line is 0', () => {
    const updated = insertMarkdownFact(NOTE, {
      rel: 'Task',
      row: ['n.md', 'open', 'water plants', 0],
    })
    expect(updated.split('\n').at(-1)).toBe('- [ ] water plants')
    const facts = parseMarkdown('n.md', updated, 0).facts
    expect(facts.filter((f) => f.rel === 'Task')).toHaveLength(4)
  })

  it('appends before a trailing newline', () => {
    const updated = insertMarkdownFact(`${NOTE}\n`, {
      rel: 'Task',
      row: ['n.md', 'closed', 'done thing', 0],
    })
    expect(updated.endsWith('- [x] done thing\n')).toBe(true)
  })

  it('inserts before the given 1-based line', () => {
    const updated = insertMarkdownFact(NOTE, {
      rel: 'Task',
      row: ['n.md', 'open', 'first!', 10],
    })
    const lines = updated.split('\n')
    expect(lines[9]).toBe('- [ ] first!')
    expect(lines[10]).toBe('- [ ] buy milk')
  })

  it('validates status, text and range', () => {
    expect(() =>
      insertMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'maybe', 'x', 0] }),
    ).toThrow(/status must be/)
    expect(() =>
      insertMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'open', 'a\nb', 0] }),
    ).toThrow(/cannot contain newlines/)
    expect(() =>
      insertMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'open', 'x', 99] }),
    ).toThrow(/out of range/)
  })
})

describe('updateMarkdownFact: general', () => {
  it('leaves every other line byte-identical', () => {
    const updated = updateMarkdownFact(
      NOTE,
      { rel: 'Task', row: ['n.md', 'open', 'buy milk', 10] },
      { rel: 'Task', row: ['n.md', 'closed', 'buy milk', 10] },
    )
    const before = NOTE.split('\n')
    const after = updated.split('\n')
    expect(after.length).toBe(before.length)
    for (let i = 0; i < before.length; i++) {
      if (i !== 9) expect(after[i]).toBe(before[i])
    }
  })

  it('preserves CRLF line endings', () => {
    const crlf = NOTE.split('\n').join('\r\n')
    const updated = updateMarkdownFact(
      crlf,
      { rel: 'Task', row: ['n.md', 'open', 'buy milk', 10] },
      { rel: 'Task', row: ['n.md', 'closed', 'buy milk', 10] },
    )
    expect(updated.includes('- [x] buy milk\r\n')).toBe(true)
    // No line lost its CR: splitting on \n leaves every non-final line \r-terminated.
    const lines = updated.split('\n')
    for (const l of lines.slice(0, -1)) expect(l.endsWith('\r')).toBe(true)
  })

  it('rejects unknown relations', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Tag', row: ['n.md', 'tag'] },
        { rel: 'Tag', row: ['n.md', 'other'] },
      ),
    ).toThrow(/not writable by the markdown plugin/)
  })
})
