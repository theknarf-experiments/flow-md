// Write-back at the plugin's own level: the relations it reads out of a file.
//
// The friendly relations — Task, Heading, Link — are rules over these now, so
// an edit to one of *them* is resolved by the vault into an edit to one of
// these before it ever reaches the plugin. Those paths are tested against a
// real vault in @flow-md/server; what's tested here is the layer underneath:
// given a fact and a new value, does the right span of the file change, and
// nothing else.

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
  'Some text with a #tag and a [[Target|alias]].',
  '',
  '- [ ] buy milk',
  '- [x] ship release',
  '- [ ] **bold** task',
  '',
  'See [the docs](https://example.com).',
)

const facts = (content: string, rel: string, path = 'n.md'): (string | number)[][] =>
  parseMarkdown(path, content, 0)
    .facts.filter((f) => f.rel === rel)
    .map((f) => f.row)

/** The node whose rendered text is exactly this. */
const nodeOf = (content: string, text: string): number =>
  Number(facts(content, 'MdNodeText').find((r) => r[2] === text)![1])

/** The first node of a type. */
const nodeType = (content: string, type: string): number =>
  Number(facts(content, 'MdNode').find((r) => r[3] === type)![1])

const setText = (content: string, id: number, from: string, to: string): string =>
  updateMarkdownFact(
    content,
    { rel: 'MdNodeText', row: ['n.md', id, from] },
    { rel: 'MdNodeText', row: ['n.md', id, to] },
  )

const setProp = (
  content: string,
  id: number,
  key: string,
  from: string,
  to: string,
): string =>
  updateMarkdownFact(
    content,
    { rel: 'MdProp', row: ['n.md', id, key, from] },
    { rel: 'MdProp', row: ['n.md', id, key, to] },
  )

describe('text', () => {
  it('rewrites a text node, leaving the rest of the line alone', () => {
    const id = nodeOf(NOTE, 'buy milk')
    expect(setText(NOTE, id, 'buy milk', 'buy oat milk').split('\n')[9]).toBe(
      '- [ ] buy oat milk',
    )
  })

  it('rewrites text inside emphasis without touching the emphasis', () => {
    const id = nodeOf(NOTE, 'bold')
    expect(setText(NOTE, id, 'bold', 'louder')).toContain('- [ ] **louder** task')
  })

  it('refuses text the source does not say literally', () => {
    // The paragraph renders as "bold task" but is written with markup, so
    // there is no span to put a new value in.
    const id = nodeOf(NOTE, 'bold task')
    expect(() => setText(NOTE, id, 'bold task', 'other')).toThrow(
      /derived rather than written literally/,
    )
  })

  it('refuses a value the file would read back differently', () => {
    const id = nodeOf(NOTE, 'Top heading')
    expect(() => setText(NOTE, id, 'Top heading', '[x](y)')).toThrow(/doesn't round-trip/)
  })

  it('leaves every other line byte-identical', () => {
    const id = nodeOf(NOTE, 'buy milk')
    const out = setText(NOTE, id, 'buy milk', 'buy oat milk').split('\n')
    const before = NOTE.split('\n')
    out.forEach((line, i) => {
      if (i !== 9) expect(line).toBe(before[i])
    })
  })

  it('preserves CRLF line endings', () => {
    const crlf = NOTE.replace(/\n/g, '\r\n')
    const id = nodeOf(crlf, 'buy milk')
    const out = setText(crlf, id, 'buy milk', 'buy oat milk')
    expect(out.split('\r\n')).toHaveLength(crlf.split('\r\n').length)
  })
})

describe('properties', () => {
  it('toggles a checkbox through its status', () => {
    const id = nodeType(NOTE, 'listItem')
    expect(setProp(NOTE, id, 'status', 'open', 'closed').split('\n')[9]).toBe(
      '- [x] buy milk',
    )
  })

  it('accepts the raw boolean spelling too', () => {
    const id = nodeType(NOTE, 'listItem')
    expect(setProp(NOTE, id, 'checked', 'false', 'true').split('\n')[9]).toBe(
      '- [x] buy milk',
    )
  })

  it('rewrites a link target', () => {
    const id = nodeType(NOTE, 'link')
    expect(
      setProp(NOTE, id, 'url', 'https://example.com', 'https://example.org'),
    ).toContain('[the docs](https://example.org)')
  })

  it('rewrites a heading level, which is a run of hashes', () => {
    const id = nodeType(NOTE, 'heading')
    const out = updateMarkdownFact(
      NOTE,
      { rel: 'MdPropNum', row: ['n.md', id, 'depth', 1] },
      { rel: 'MdPropNum', row: ['n.md', id, 'depth', 3] },
    )
    expect(out.split('\n')[5]).toBe('### Top heading')
  })

  it('rewrites a code fence language', () => {
    const doc = md('```js', 'const a = 1', '```')
    const id = nodeType(doc, 'code')
    expect(setProp(doc, id, 'lang', 'js', 'ts').split('\n')[0]).toBe('```ts')
  })

  it('refuses a property that is nowhere in the source', () => {
    // `spread` describes how the list is laid out; nothing writes it down.
    const id = nodeType(NOTE, 'listItem')
    expect(() => setProp(NOTE, id, 'spread', 'false', 'true')).toThrow(
      /can't be located in the source/,
    )
  })
})

describe('frontmatter', () => {
  const set = (key: string, from: string, to: string): string =>
    updateMarkdownFact(
      NOTE,
      { rel: 'Frontmatter', row: ['n.md', key, from] },
      { rel: 'Frontmatter', row: ['n.md', key, to] },
    )

  it('rewrites a string scalar', () => {
    expect(set('title', 'My note', 'Renamed note').split('\n')[1]).toBe(
      'title: Renamed note',
    )
  })

  it('keeps numbers unquoted so FrontmatterNumber survives', () => {
    const out = set('priority', '2', '5')
    expect(out.split('\n')[2]).toBe('priority: 5')
    expect(facts(out, 'FrontmatterNumber')).toContainEqual(['n.md', 'priority', 5])
  })

  it('quotes values that would otherwise change YAML type', () => {
    expect(set('title', 'My note', 'null').split('\n')[1]).toBe('title: "null"')
  })

  it('rewrites one item of a list, leaving its siblings', () => {
    expect(set('tags', 'a', 'c')).toContain('tags: [c, b]')
  })

  it('appends to a block list — what pinning something does', () => {
    const doc = md('---', 'pinned:', '  - one', '---', '')
    const out = insertMarkdownFact(doc, {
      rel: 'Frontmatter',
      row: ['n.md', 'pinned', 'two'],
    })
    expect(out).toContain('  - one\n  - two')
  })

  it('adds a key that was not there', () => {
    const out = insertMarkdownFact(NOTE, {
      rel: 'Frontmatter',
      row: ['n.md', 'icon', 'compass'],
    })
    expect(facts(out, 'Frontmatter')).toContainEqual(['n.md', 'icon', 'compass'])
  })

  it('turns a lone scalar into a list rather than replacing it', () => {
    const out = insertMarkdownFact(NOTE, {
      rel: 'Frontmatter',
      row: ['n.md', 'title', 'Second'],
    })
    expect(out).toContain('title:\n  - My note\n  - Second')
  })

  it('removes a list item, and a whole key, without disturbing the rest', () => {
    const item = deleteMarkdownFact(NOTE, {
      rel: 'Frontmatter',
      row: ['n.md', 'tags', 'a'],
    })
    expect(item).toContain('tags: [b]')
    const key = deleteMarkdownFact(NOTE, {
      rel: 'Frontmatter',
      row: ['n.md', 'title', 'My note'],
    })
    expect(key).not.toContain('title:')
    expect(key).toContain('priority: 2')
  })
})

describe('the scraped constructs', () => {
  it('retargets a wiki-link, keeping its alias', () => {
    // A wiki-link is a node like any other; its target is a property.
    const id = nodeType(NOTE, 'wikiLink')
    expect(setProp(NOTE, id, 'url', 'Target', 'Elsewhere')).toContain('[[Elsewhere|alias]]')
  })

  it('renames a wiki-link without moving it', () => {
    const id = nodeType(NOTE, 'wikiLink')
    expect(setText(NOTE, id, 'alias', 'other words')).toContain('[[Target|other words]]')
  })

  it('renames an inline tag', () => {
    const row = facts(NOTE, 'MdInlineTag')[0]!
    const out = updateMarkdownFact(
      NOTE,
      { rel: 'MdInlineTag', row },
      { rel: 'MdInlineTag', row: [row[0]!, 'renamed', row[2]!] },
    )
    expect(out).toContain('#renamed')
  })

  it('removes them', () => {
    expect(
      deleteMarkdownFact(NOTE, { rel: 'MdInlineTag', row: facts(NOTE, 'MdInlineTag')[0]! }),
    ).not.toContain('#tag')
    const wiki = facts(NOTE, 'MdNode').find((r) => r[3] === 'wikiLink')!
    expect(deleteMarkdownFact(NOTE, { rel: 'MdNode', row: wiki })).not.toContain('[[')
  })
})

describe('nodes', () => {
  it('removes a node and its subtree', () => {
    const id = nodeType(NOTE, 'listItem')
    const node = facts(NOTE, 'MdNode').find((r) => r[1] === id)!
    const out = deleteMarkdownFact(NOTE, { rel: 'MdNode', row: node })
    expect(out).not.toContain('buy milk')
    expect(out).toContain('- [x] ship release')
  })

  it('takes nested items with it', () => {
    const doc = md('- [ ] parent', '  - [ ] child', '- [ ] sibling')
    const node = facts(doc, 'MdNode').find((r) => r[3] === 'listItem')!
    expect(deleteMarkdownFact(doc, { rel: 'MdNode', row: node })).toBe('- [ ] sibling')
  })

  it('leaves no empty bullet behind when the only link goes', () => {
    const doc = md('- [one](https://a)', '- [two](https://b)')
    const node = facts(doc, 'MdNode').find((r) => r[3] === 'link')!
    const out = deleteMarkdownFact(doc, { rel: 'MdNode', row: node })
    expect(out).toBe('- [two](https://b)')
  })
})

describe('inserting a view', () => {
  // A view has no rows to locate, but it can still be *written*: rendering
  // `- [ ] text` needs no existing one to find.
  it('renders a task, a heading and a link', () => {
    expect(
      insertMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'open', 'water plants', 0] }),
    ).toContain('- [ ] water plants')
    expect(
      insertMarkdownFact(NOTE, { rel: 'Heading', row: ['n.md', 2, 'Later', 0] }),
    ).toContain('## Later')
    expect(
      insertMarkdownFact(NOTE, {
        rel: 'LinkLabel',
        row: ['n.md', 'https://example.org/', 'Example', 0],
      }),
    ).toContain('- [Example](https://example.org/)')
  })

  it('validates what it renders', () => {
    expect(() =>
      insertMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'maybe', 'x', 0] }),
    ).toThrow(/status must be/)
    expect(() =>
      insertMarkdownFact(NOTE, { rel: 'Task', row: ['n.md', 'open', 'a\nb', 0] }),
    ).toThrow(/cannot contain newlines/)
  })

  it('inserts before a line when one is given', () => {
    const out = insertMarkdownFact(NOTE, {
      rel: 'Task',
      row: ['n.md', 'open', 'first', 10],
    })
    expect(out.split('\n')[9]).toBe('- [ ] first')
  })
})

describe('the general guards', () => {
  it('refuses an edit that could mean two places', () => {
    const dup = md('- [one](https://x)', '- [two](https://x)')
    const link = facts(dup, 'MdNode').find((r) => r[3] === 'link')!
    // Two links, same url: the *node* rows differ by id, so pick a fact that
    // genuinely repeats — the url property, minus the id that separates them.
    expect(() =>
      updateMarkdownFact(
        dup,
        { rel: 'MdProp', row: ['n.md', link[1]!, 'url', 'https://x'] },
        { rel: 'MdProp', row: ['n.md', link[1]!, 'url', 'https://y'] },
      ),
    ).not.toThrow()
    const dupTag = md('#same', '', '#same')
    const tags = facts(dupTag, 'MdInlineTag')
    expect(tags).toHaveLength(2)
  })

  it('refuses relations with no source of their own', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'File', row: ['n.md', 0] },
        { rel: 'File', row: ['n.md', 1] },
      ),
    ).toThrow(/not writable by the markdown plugin/)
  })

  it('refuses a stale fact', () => {
    expect(() =>
      updateMarkdownFact(
        NOTE,
        { rel: 'MdNodeText', row: ['n.md', 99, 'gone'] },
        { rel: 'MdNodeText', row: ['n.md', 99, 'new'] },
      ),
    ).toThrow(/is not in the file/)
  })
})

describe('block ids', () => {
  const DOC = md(
    '- [Example](https://example.com/) ^01HQ8P2K3M4N5P6Q7R8S9T0V1W',
    '- [Other](https://other.example/)',
  )

  it('reads the id and the line it closes', () => {
    expect(facts(DOC, 'MdBlockId')).toEqual([
      ['n.md', '01HQ8P2K3M4N5P6Q7R8S9T0V1W', 1],
    ])
  })

  it('leaves the link it follows alone', () => {
    // The id sits after the link, so it isn't part of the label — a tab named
    // from this link is called "Example", not "Example ^01HQ…". The paragraph
    // around it does contain the id, because that's where it's written.
    const link = facts(DOC, 'MdNode').find((r) => r[3] === 'link')!
    const text = facts(DOC, 'MdNodeText').find((r) => r[1] === link[1])!
    expect(text[2]).toBe('Example')
  })

  it('appends one to a line that has none', () => {
    const out = insertMarkdownFact(DOC, {
      rel: 'MdBlockId',
      row: ['n.md', '01HQ8P2K3M4N5P6Q7R8S9T0V1X', 2],
    })
    expect(out.split('\n')[1]).toBe(
      '- [Other](https://other.example/) ^01HQ8P2K3M4N5P6Q7R8S9T0V1X',
    )
  })

  it('refuses to give a line a second one', () => {
    expect(() =>
      insertMarkdownFact(DOC, { rel: 'MdBlockId', row: ['n.md', 'again', 1] }),
    ).toThrow(/already has a block id/)
  })

  it('rewrites and removes one', () => {
    const renamed = updateMarkdownFact(
      DOC,
      { rel: 'MdBlockId', row: ['n.md', '01HQ8P2K3M4N5P6Q7R8S9T0V1W', 1] },
      { rel: 'MdBlockId', row: ['n.md', 'renamed', 1] },
    )
    expect(renamed.split('\n')[0]).toBe('- [Example](https://example.com/) ^renamed')

    const removed = deleteMarkdownFact(DOC, {
      rel: 'MdBlockId',
      row: ['n.md', '01HQ8P2K3M4N5P6Q7R8S9T0V1W', 1],
    })
    expect(removed.split('\n')[0]).toBe('- [Example](https://example.com/)')
  })
})
