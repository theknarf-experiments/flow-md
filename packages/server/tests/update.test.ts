import type { Plugin } from '@flow-md/plugin-api'
import { markdownPlugin } from '@flow-md/plugin-markdown'
import { describe, expect, it } from 'vitest'
import { Vault } from '../src/vault.js'

const plugins = [markdownPlugin]

// Built from line arrays because a ``` fence inside a backtick template
// literal would terminate the template.
function md(...lines: string[]): string {
  return lines.join('\n')
}

const TODO = md(
  '# Todo', //                       line 1
  '',
  '- [ ] buy milk', //               line 3
  '- [x] ship release', //           line 4
  '',
  '```datalog-query',
  'Task(path, status, text, line)',
  '```',
)

function vaultWith(content: string): Vault {
  const vault = new Vault(plugins)
  vault.setFile('todo.md', content, 1)
  vault.advance()
  return vault
}

describe('Vault lineage: writable columns', () => {
  it('marks columns writable when they trace to a writable EDB attribute', () => {
    const vault = vaultWith(TODO)
    const q = vault.queries('todo.md')[0]!
    expect(q.source).toBe('Task(path, status, text, line)')
    expect(q.columns).toEqual(['path', 'status', 'text', 'line'])
    expect(q.writable).toEqual(['status', 'text'])
  })

  it('reports writable columns for ad-hoc queries too', () => {
    const vault = vaultWith(TODO)
    const r = vault.runQuery('Task(p, "open", t, _)')
    expect(r.error).toBeNull()
    expect(r.writable).toEqual(['t'])
  })

  it('unfolds a single non-recursive IDB rule: derived columns stay writable', () => {
    const vault = vaultWith(
      md(
        '```datalog',
        'Open(p, t) :- Task(p, "open", t, _).',
        '```',
        '',
        '- [ ] something',
      ),
    )
    const r = vault.runQuery('Open(p, t)')
    expect(r.error).toBeNull()
    expect(r.writable).toEqual(['t'])
  })

  it('unfolds through two IDB levels', () => {
    const vault = vaultWith(
      md(
        '```datalog',
        'Open(p, t) :- Task(p, "open", t, _).',
        'Todo(t) :- Open(_, t).',
        '```',
        '',
        '- [ ] something',
      ),
    )
    const r = vault.runQuery('Todo(t)')
    expect(r.error).toBeNull()
    expect(r.writable).toEqual(['t'])
  })

  it('does not unfold heads defined by several rules', () => {
    const vault = vaultWith(
      md(
        '```datalog',
        'Item(p, t) :- Task(p, "open", t, _).',
        'Item(p, t) :- Heading(p, _, t, _).',
        '```',
        '',
        '- [ ] something',
      ),
    )
    const r = vault.runQuery('Item(p, t)')
    expect(r.error).toBeNull()
    expect(r.writable).toEqual([])
  })
})

describe('Vault.resolveUpdate', () => {
  it('reconstructs the source fact when the row pins every column', () => {
    const vault = vaultWith(TODO)
    const r = vault.resolveUpdate(
      'Task(path, status, text, line)',
      ['todo.md', 'open', 'buy milk', 3],
      'status',
      'closed',
    )
    expect(r.path).toBe('todo.md')
    expect(r.oldFact).toEqual({ rel: 'Task', row: ['todo.md', 'open', 'buy milk', 3] })
    expect(r.newFact).toEqual({ rel: 'Task', row: ['todo.md', 'closed', 'buy milk', 3] })
  })

  it('recovers placeholder columns from the current facts when unique', () => {
    const vault = vaultWith(TODO)
    const r = vault.resolveUpdate(
      'Task(path, "open", text, _)',
      ['todo.md', 'buy milk'],
      'text',
      'buy oat milk',
    )
    expect(r.oldFact.row).toEqual(['todo.md', 'open', 'buy milk', 3])
    expect(r.newFact.row).toEqual(['todo.md', 'open', 'buy oat milk', 3])
  })

  it('rejects a placeholder edit matching several facts', () => {
    const vault = vaultWith(md('- [ ] dup', '- [ ] dup'))
    expect(() =>
      vault.resolveUpdate('Task(path, "open", text, _)', ['todo.md', 'dup'], 'text', 'x'),
    ).toThrow(/2 Task facts match/)
  })

  it('rejects edits through a joined variable', () => {
    const vault = vaultWith(TODO)
    expect(() =>
      vault.resolveUpdate(
        'Task(p, s, t, l), Heading(p2, lvl, t, hl)',
        ['todo.md', 'open', 'buy milk', 3, 'todo.md', 1, 1],
        't',
        'x',
      ),
    ).toThrow(/joins several relation positions/)
  })

  it('rejects edits to read-only attributes and unknown columns', () => {
    const vault = vaultWith(TODO)
    const source = 'Task(path, status, text, line)'
    const row = ['todo.md', 'open', 'buy milk', 3]
    expect(() => vault.resolveUpdate(source, row, 'line', 7)).toThrow(
      /Task\.line is not writable/,
    )
    expect(() => vault.resolveUpdate(source, row, 'nope', 'x')).toThrow(
      /no column "nope"/,
    )
  })

  it('rejects a row that no longer matches any fact', () => {
    const vault = vaultWith(TODO)
    expect(() =>
      vault.resolveUpdate(
        'Task(path, status, text, line)',
        ['todo.md', 'open', 'gone task', 9],
        'status',
        'closed',
      ),
    ).toThrow(/no longer in the vault/)
  })

  it('coerces and validates the new value against the schema type', () => {
    const vault = vaultWith(TODO)
    const r = vault.resolveUpdate(
      'Task(path, status, text, line)',
      ['todo.md', 'open', 'buy milk', 3],
      'text',
      42,
    )
    expect(r.newFact.row[2]).toBe('42')
  })
})

describe('Vault.resolveUpdate through IDB rules', () => {
  const NOTE = md(
    '```datalog', //                                 line 1
    'Open(p, t) :- Task(p, "open", t, _).',
    '```',
    '',
    '- [ ] something', //                            line 5
  )

  it('traces an edit through an unfolded rule to the Task fact', () => {
    const vault = vaultWith(NOTE)
    const r = vault.resolveUpdate('Open(p, t)', ['todo.md', 'something'], 't', 'changed')
    expect(r.path).toBe('todo.md')
    expect(r.oldFact).toEqual({ rel: 'Task', row: ['todo.md', 'open', 'something', 5] })
    expect(r.newFact).toEqual({ rel: 'Task', row: ['todo.md', 'open', 'changed', 5] })
  })
})

describe('Vault.resolveDelete / resolveInsert', () => {
  it('resolves a delete from a query row', () => {
    const vault = vaultWith(TODO)
    const r = vault.resolveDelete({
      source: 'Task(path, status, text, line)',
      row: ['todo.md', 'open', 'buy milk', 3],
    })
    expect(r.path).toBe('todo.md')
    expect(r.fact).toEqual({ rel: 'Task', row: ['todo.md', 'open', 'buy milk', 3] })
  })

  it('resolves a delete from a complete fact', () => {
    const vault = vaultWith(TODO)
    const r = vault.resolveDelete({
      rel: 'Task',
      row: ['todo.md', 'closed', 'ship release', 4],
    })
    expect(r.path).toBe('todo.md')
  })

  it('rejects deletes of relations no plugin can delete', () => {
    const vault = vaultWith(TODO)
    expect(() =>
      vault.resolveDelete({ rel: 'Heading', row: ['todo.md', 1, 'Todo', 1] }),
    ).toThrow(/cannot be deleted/)
  })

  it('validates inserts: capability, arity and target file', () => {
    const vault = vaultWith(TODO)
    const ok = vault.resolveInsert('Task', ['todo.md', 'open', 'new item', 0])
    expect(ok.path).toBe('todo.md')

    expect(() => vault.resolveInsert('Heading', ['todo.md', 1, 'x', 0])).toThrow(
      /cannot be inserted/,
    )
    expect(() => vault.resolveInsert('Task', ['todo.md', 'open'])).toThrow(
      /has 4 columns/,
    )
    expect(() =>
      vault.resolveInsert('Task', ['nope.md', 'open', 'x', 0]),
    ).toThrow(/no file "nope.md"/)
  })
})

describe('writable declarations are validated at startup', () => {
  /** A plugin skeleton that parses nothing; each test perturbs `writable`. */
  const base: Plugin = {
    name: 'fake',
    extensions: ['.fake'],
    schema: [
      {
        name: 'Note',
        attrs: [
          ['title', 'string'],
          ['file', 'string'],
          ['stars', 'number'],
        ],
      },
    ],
    parse: () => ({ facts: [], rules: [], queries: [] }),
    updateFact: (c) => c,
    deleteFact: (c) => c,
    insertFact: (c) => c,
  }
  const withWritable = (
    writable: NonNullable<Plugin['writable']>,
    strip?: 'updateFact' | 'deleteFact' | 'insertFact',
  ) => {
    const p: Plugin = { ...base, writable }
    if (strip) delete p[strip]
    return () => new Vault([p])
  }

  it('accepts a well-formed declaration, honoring a non-first pathAttr', () => {
    const vault = new Vault([
      markdownPlugin,
      {
        ...base,
        writable: [
          { rel: 'Note', cols: ['title'], canInsert: true, pathAttr: 'file' },
        ],
      },
    ])
    vault.setFile('todo.md', '# Hi', 1)
    vault.advance()
    // The path is read from the declared column (index 1), not column 0.
    const r = vault.resolveInsert('Note', ['hello', 'todo.md', 5])
    expect(r.path).toBe('todo.md')
    expect(() => vault.resolveInsert('Note', ['todo.md', '', 5])).toThrow(
      /Note\.file must name the target file/,
    )
  })

  it('rejects unknown relations and columns', () => {
    expect(withWritable([{ rel: 'Nope', cols: [] }])).toThrow(
      /writable relation "Nope" is not in the plugin's schema/,
    )
    expect(withWritable([{ rel: 'Note', cols: ['nope'] }])).toThrow(
      /writable column "Note.nope" is not in the relation's schema/,
    )
  })

  it('rejects capabilities without the backing method', () => {
    expect(withWritable([{ rel: 'Note', cols: ['title'] }], 'updateFact')).toThrow(
      /declares writable columns but no updateFact/,
    )
    expect(
      withWritable([{ rel: 'Note', cols: [], canDelete: true }], 'deleteFact'),
    ).toThrow(/declares canDelete but no deleteFact/)
    expect(
      withWritable(
        [{ rel: 'Note', cols: [], canInsert: true, pathAttr: 'file' }],
        'insertFact',
      ),
    ).toThrow(/declares canInsert but no insertFact/)
  })

  it('rejects inserts without a valid string pathAttr', () => {
    expect(withWritable([{ rel: 'Note', cols: [], canInsert: true }])).toThrow(
      /declares canInsert but no pathAttr/,
    )
    expect(
      withWritable([{ rel: 'Note', cols: [], canInsert: true, pathAttr: 'nope' }]),
    ).toThrow(/pathAttr "Note.nope" is not in the relation's schema/)
    expect(
      withWritable([{ rel: 'Note', cols: [], canInsert: true, pathAttr: 'stars' }]),
    ).toThrow(/pathAttr "Note.stars" must be a string attribute/)
  })
})

describe('Vault.applyFactDelete / applyFactInsert', () => {
  it('deletes a task line and the query reflects it', () => {
    const vault = vaultWith(TODO)
    const fact = { rel: 'Task', row: ['todo.md', 'open', 'buy milk', 3] }
    const updated = vault.applyFactDelete('todo.md', TODO, fact)
    expect(updated.split('\n')[2]).toBe('- [x] ship release')

    vault.setFile('todo.md', updated, 2)
    vault.advance()
    const rows = vault.queries('todo.md')[0]!.rows
    expect(rows).toHaveLength(1)
  })

  it('rejects a stale delete', () => {
    const vault = vaultWith(TODO)
    const fact = { rel: 'Task', row: ['todo.md', 'open', 'gone', 3] }
    expect(() => vault.applyFactDelete('todo.md', TODO, fact)).toThrow(
      /no longer contains the fact/,
    )
  })

  it('inserts a task (append) and the query picks it up', () => {
    const vault = vaultWith(TODO)
    const fact = { rel: 'Task', row: ['todo.md', 'open', 'water plants', 0] }
    const updated = vault.applyFactInsert('todo.md', TODO, fact)
    expect(updated.split('\n').at(-1)).toBe('- [ ] water plants')

    vault.setFile('todo.md', updated, 2)
    vault.advance()
    const rows = vault.queries('todo.md')[0]!.rows
    expect(rows.map((r) => r[2])).toContain('water plants')
  })
})

describe('Vault.applyFactUpdate', () => {
  const oldFact = { rel: 'Task', row: ['todo.md', 'open', 'buy milk', 3] }
  const newFact = { rel: 'Task', row: ['todo.md', 'closed', 'buy milk', 3] }

  it('rewrites content and the change flows back through setFile', () => {
    const vault = vaultWith(TODO)
    const updated = vault.applyFactUpdate('todo.md', TODO, oldFact, newFact)
    expect(updated.split('\n')[2]).toBe('- [x] buy milk')

    vault.setFile('todo.md', updated, 2)
    vault.advance()
    const rows = vault.queries('todo.md')[0]!.rows
    expect(rows).toContainEqual(['todo.md', 'closed', 'buy milk', 3])
    expect(rows).not.toContainEqual(['todo.md', 'open', 'buy milk', 3])
  })

  it('rejects stale content (the concurrency check)', () => {
    const vault = vaultWith(TODO)
    const changed = TODO.replace('- [ ] buy milk', '- [x] buy milk')
    expect(() =>
      vault.applyFactUpdate('todo.md', changed, oldFact, newFact),
    ).toThrow(/no longer contains the fact/)
  })
})
