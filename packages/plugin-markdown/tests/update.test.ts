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

  it('rewrites formatted task text, flattening the markup it replaces', () => {
    // The fact's text is the *rendered* text, so writing a new one replaces
    // the whole label — the `**bold**` goes with it. Editing rendered text
    // can't preserve markup it doesn't describe.
    const out = updateMarkdownFact(
      NOTE,
      { rel: 'Task', row: ['n.md', 'open', 'bold task', 12] },
      { rel: 'Task', row: ['n.md', 'open', 'other', 12] },
    )
    expect(out).toContain('- [ ] other')
    expect(out).not.toContain('**bold**')
  })

  it('rejects a stale status', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Task', row: ['n.md', 'closed', 'buy milk', 10] },
        { rel: 'Task', row: ['n.md', 'open', 'buy milk', 10] },
      ),
    ).toThrow(/is not in the file/)
  })

  it('rejects a line that is not a task', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Task', row: ['n.md', 'open', 'buy milk', 8] },
        { rel: 'Task', row: ['n.md', 'closed', 'buy milk', 8] },
      ),
    ).toThrow(/is not in the file/)
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
    ).toThrow(/is not in the file/)
  })

  it('rejects a value the file would read back differently', () => {
    // No rule about what headings may contain — the check is that the file
    // says the requested thing afterwards, and `[x](y)` reads back as "x".
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Heading', row: ['n.md', 1, 'Top heading', 6] },
        { rel: 'Heading', row: ['n.md', 1, '[x](y)', 6] },
      ),
    ).toThrow(/doesn't round-trip/)
  })

  it('rewrites the level, which is just another span', () => {
    const out = updateMarkdownFact(
      NOTE,
      { rel: 'Heading', row: ['n.md', 1, 'Top heading', 6] },
      { rel: 'Heading', row: ['n.md', 3, 'Top heading', 6] },
    )
    expect(out).toContain('### Top heading')
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

  it('rewrites one item of a list, leaving its siblings alone', () => {
    const out = updateMarkdownFact(
      NOTE,
      { rel: 'Frontmatter', row: ['n.md', 'tags', 'a'] },
      { rel: 'Frontmatter', row: ['n.md', 'tags', 'c'] },
    )
    expect(out).toContain('tags: [c, b]')
  })

  it('rejects a stale value', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'Frontmatter', row: ['n.md', 'title', 'Old title'] },
        { rel: 'Frontmatter', row: ['n.md', 'title', 'New'] },
      ),
    ).toThrow(/is not in the file/)
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
    ).toThrow(/is not in the file/)
    expect(() =>
      deleteMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'open', 'x', 6] }),
    ).toThrow(/is not in the file/)
    expect(() =>
      deleteMarkdownFact(NOTE, { rel: 'File', row: ['n.md', 0] }),
    ).toThrow(/not writable by the markdown plugin/)
  })

  it('removes a heading line', () => {
    const out = deleteMarkdownFact(NOTE, {
      rel: 'Heading',
      row: ['n.md', 1, 'Top heading', 6],
    })
    expect(out).not.toContain('# Top heading')
    expect(out).toContain('- [ ] buy milk')
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

  it('rejects relations with no source of their own', () => {
    // File is derived from the filesystem, not from anything written in the
    // file, so there is nothing to rewrite.
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'File', row: ['n.md', 0] },
        { rel: 'File', row: ['n.md', 1] },
      ),
    ).toThrow(/not writable by the markdown plugin/)
  })

  it('refuses an edit that could mean two places', () => {
    // Link has no line column, so the same URL twice is genuinely two
    // candidates. (LinkLabel does carry a line, which is why it's the one to
    // write through when a page can appear twice.)
    const dup = md('- [one](https://x)', '- [two](https://x)')
    expect(() =>
      updateMarkdownFact(
        dup,
        { rel: 'Link', row: ['n.md', 'https://x', 'md'] },
        { rel: 'Link', row: ['n.md', 'https://y', 'md'] },
      ),
    ).toThrow(/appears 2 times/)
  })
})

// A space file, in the shape the browser shell reads: frontmatter for the
// space itself, links for its tabs.
const SPACE = md(
  '---',
  'name: Research',
  'emoji: 🔭',
  'hue: 190',
  'pinned:',
  '  - https://tanstack.com/hotkeys',
  '---',
  '',
  '- [Vim (text editor)](https://en.wikipedia.org/wiki/Vim)',
  '- [Controlled Frame](https://wicg.github.io/controlled-frame/)',
  '',
)

describe('LinkLabel', () => {
  it('is parsed with its label and line', () => {
    const facts = parseMarkdown('s.md', SPACE, 0).facts
    expect(facts).toContainEqual({
      rel: 'LinkLabel',
      row: ['s.md', 'https://en.wikipedia.org/wiki/Vim', 'Vim (text editor)', 9],
    })
    // Link keeps its old shape, so existing queries still work.
    expect(facts).toContainEqual({
      rel: 'Link',
      row: ['s.md', 'https://en.wikipedia.org/wiki/Vim', 'md'],
    })
  })

  it('renames a link without touching its target', () => {
    const out = updateMarkdownFact(
      SPACE,
      { rel: 'LinkLabel', row: ['s.md', 'https://en.wikipedia.org/wiki/Vim', 'Vim (text editor)', 9] },
      { rel: 'LinkLabel', row: ['s.md', 'https://en.wikipedia.org/wiki/Vim', 'Vim', 9] },
    )
    expect(out).toContain('- [Vim](https://en.wikipedia.org/wiki/Vim)')
  })

  it('retargets a link without touching its name', () => {
    const out = updateMarkdownFact(
      SPACE,
      { rel: 'LinkLabel', row: ['s.md', 'https://en.wikipedia.org/wiki/Vim', 'Vim (text editor)', 9] },
      { rel: 'LinkLabel', row: ['s.md', 'https://neovim.io/', 'Vim (text editor)', 9] },
    )
    expect(out).toContain('- [Vim (text editor)](https://neovim.io/)')
  })

  it('appends one, and removes one, line for line', () => {
    const added = insertMarkdownFact(SPACE, {
      rel: 'LinkLabel',
      row: ['s.md', 'https://example.com/', 'Example', 0],
    })
    expect(added).toContain('- [Example](https://example.com/)')

    const removed = deleteMarkdownFact(added, {
      rel: 'LinkLabel',
      row: ['s.md', 'https://example.com/', 'Example', 11],
    })
    expect(removed).not.toContain('example.com')
    expect(removed).toContain('- [Controlled Frame](https://wicg.github.io/controlled-frame/)')
  })

  it('carries a wiki-link alias as the label', () => {
    const facts = parseMarkdown('s.md', 'See [[Target|the target]].', 0).facts
    expect(facts).toContainEqual({
      rel: 'LinkLabel',
      row: ['s.md', 'Target', 'the target', 1],
    })
  })
})

describe('Frontmatter: adding and removing entries', () => {
  it('appends to a block list — what pinning a tab does', () => {
    const out = insertMarkdownFact(SPACE, {
      rel: 'Frontmatter',
      row: ['s.md', 'pinned', 'https://example.com/'],
    })
    expect(out).toContain('  - https://tanstack.com/hotkeys\n  - https://example.com/')
  })

  it('adds a key that was not there', () => {
    const out = insertMarkdownFact(SPACE, {
      rel: 'Frontmatter',
      row: ['s.md', 'icon', 'compass'],
    })
    expect(out).toContain('icon: compass')
    expect(parseMarkdown('s.md', out, 0).facts).toContainEqual({
      rel: 'Frontmatter',
      row: ['s.md', 'icon', 'compass'],
    })
  })

  it('turns a lone scalar into a list rather than replacing it', () => {
    const out = insertMarkdownFact(SPACE, {
      rel: 'Frontmatter',
      row: ['s.md', 'name', 'Reading'],
    })
    expect(out).toContain('name:\n  - Research\n  - Reading')
  })

  it('removes a list item without disturbing the rest', () => {
    const out = deleteMarkdownFact(SPACE, {
      rel: 'Frontmatter',
      row: ['s.md', 'pinned', 'https://tanstack.com/hotkeys'],
    })
    expect(out).not.toContain('tanstack')
    expect(out).toContain('name: Research')
  })

  it('removes a whole key, taking its name with it', () => {
    const out = deleteMarkdownFact(SPACE, {
      rel: 'Frontmatter',
      row: ['s.md', 'emoji', '🔭'],
    })
    expect(out).not.toContain('emoji')
    expect(out).toContain('hue: 190')
  })
})

describe('the other relations write too', () => {
  it('rewrites a code fence language', () => {
    const doc = md('```js', 'const a = 1', '```')
    const out = updateMarkdownFact(
      doc,
      { rel: 'CodeBlock', row: ['n.md', 'js', 1] },
      { rel: 'CodeBlock', row: ['n.md', 'ts', 1] },
    )
    expect(out.split('\n')[0]).toBe('```ts')
  })

  it('renames an inline tag', () => {
    const out = updateMarkdownFact(
      NOTE,
      { rel: 'Tag', row: ['n.md', 'tag'] },
      { rel: 'Tag', row: ['n.md', 'renamed'] },
    )
    expect(out).toContain('Some text with a #renamed.')
  })

  it('removes a link, leaving no empty line behind', () => {
    const out = deleteMarkdownFact(SPACE, {
      rel: 'Link',
      row: ['s.md', 'https://en.wikipedia.org/wiki/Vim', 'md'],
    })
    expect(out).not.toContain('wikipedia')
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1)
  })
})
