// The vault answers write-back from its own graph.
//
// It used to build a throwaway one per edit, loading every fact in the vault
// to resolve a single cell — linear in a thing that only grows, and measured
// at 167ms for one edit over 2000 tasks. The session already holds the program
// and the facts, so it can hold the backward direction too and a request costs
// the delta: 3ms at the same size.
//
// Standing the backward direction up is about twice the cost of the forward
// one on its own, so it waits. Most vaults are read — opened, browsed, never
// edited through a rendered query — and those should not pay for machinery
// they never use. The first write-back rebuilds with it in; everything after
// is delta-priced.
//
// These are behavioural rather than timed. What matters is that the laziness
// is invisible: the same answers, before and after the rebuild it triggers.

import { markdownPlugin } from '@flow-md/plugin-markdown'
import { describe, expect, it } from 'vitest'
import { Vault } from '../src/vault.js'

const md = (...lines: string[]) => lines.join('\n')

const TODO = md(
  '# Todo',
  '',
  '- [ ] buy milk',
  '- [x] ship release',
  '',
  '```datalog-query',
  'Task(path, status, text, line)',
  '```',
)

function vaultWith(content: string): Vault {
  const vault = new Vault([markdownPlugin])
  vault.setFile('todo.md', content, 1)
  vault.advance()
  return vault
}

const textOf = (vault: Vault) =>
  vault.queries('todo.md')[0]!.rows.map((r) => String(r[2])).sort()

describe('before anything is written', () => {
  it('still reports which columns are editable', () => {
    // Writability is compiled from the rules, not read off the graph, so the
    // answer does not wait for the machinery that would act on it.
    const vault = vaultWith(TODO)
    expect(vault.queries('todo.md')[0]!.writable).toEqual(['status', 'text'])
  })

  it('and serves query results as usual', () => {
    expect(textOf(vaultWith(TODO))).toEqual(['buy milk', 'ship release'])
  })
})

describe('the first write brings the backward direction up', () => {
  it('resolves, and the rebuild it triggers is invisible', () => {
    const vault = vaultWith(TODO)
    const before = textOf(vault)
    const row = vault.queries('todo.md')[0]!.rows.find((r) => r[2] === 'buy milk')!

    const r = vault.resolveUpdate('Task(path, status, text, line)', row, 'text', 'buy oat milk')
    expect(r.rel).toBe('MdNodeText')
    expect(r.newFact.row[2]).toBe('buy oat milk')
    // The rebuild replaced the session and every query entry; the results and
    // the writability have to come back the same.
    expect(textOf(vault)).toEqual(before)
    expect(vault.queries('todo.md')[0]!.writable).toEqual(['status', 'text'])
  })

  it('and the second write goes through the standing graph', () => {
    const vault = vaultWith(TODO)
    const rows = () => vault.queries('todo.md')[0]!.rows
    const milk = rows().find((r) => r[2] === 'buy milk')!
    const ship = rows().find((r) => r[2] === 'ship release')!
    expect(vault.resolveUpdate('Task(path, status, text, line)', milk, 'text', 'a').rel).toBe(
      'MdNodeText',
    )
    // Different row, different source fact, same session.
    const second = vault.resolveUpdate('Task(path, status, text, line)', ship, 'status', 'open')
    expect(second.rel).toBe('MdProp')
    expect(second.newFact.row[3]).toBe('open')
  })
})

describe('the standing graph keeps up with the vault', () => {
  it('a file edit after the rebuild is reflected in what resolves', () => {
    const vault = vaultWith(TODO)
    const row = vault.queries('todo.md')[0]!.rows.find((r) => r[2] === 'buy milk')!
    vault.resolveUpdate('Task(path, status, text, line)', row, 'text', 'x')

    // Now change the file underneath. A graph that had stopped tracking would
    // still believe the old row exists.
    vault.setFile('todo.md', TODO.replace('- [ ] buy milk', '- [ ] buy oat milk'), 2)
    vault.advance()
    expect(textOf(vault)).toEqual(['buy oat milk', 'ship release'])

    expect(() =>
      vault.resolveUpdate('Task(path, status, text, line)', row, 'text', 'y'),
    ).toThrow(/stale result/)

    const fresh = vault.queries('todo.md')[0]!.rows.find((r) => r[2] === 'buy oat milk')!
    expect(vault.resolveUpdate('Task(path, status, text, line)', fresh, 'text', 'z').rel).toBe(
      'MdNodeText',
    )
  })

  it('a new query added after the rebuild is writable too', () => {
    const vault = vaultWith(TODO)
    const row = vault.queries('todo.md')[0]!.rows[0]!
    vault.resolveUpdate('Task(path, status, text, line)', row, 'text', 'x')

    // Adding a query dirties the program; the rebuild has to keep the backward
    // direction rather than dropping back to the lazy state.
    vault.setFile(
      'more.md',
      md('```datalog-query', 'Heading(path, depth, text, line)', '```'),
      1,
    )
    vault.advance()
    const q = vault.queries('more.md')[0]!
    expect(q.writable).toEqual(['depth', 'text'])
    const heading = q.rows[0]!
    expect(vault.resolveUpdate(q.source, heading, 'text', 'Renamed').rel).toBe('MdNodeText')
  })

  it('resolving a delete uses the same graph', () => {
    const vault = vaultWith(TODO)
    const row = vault.queries('todo.md')[0]!.rows.find((r) => r[2] === 'buy milk')!
    const d = vault.resolveDelete({ source: 'Task(path, status, text, line)', row })
    expect(d.path).toBe('todo.md')
    expect(d.fact.rel).toBe('MdNode')
  })
})

describe('an ad-hoc query has no standing graph, and still resolves', () => {
  it('through one built for the occasion', () => {
    const vault = vaultWith(TODO)
    // Never registered as a query block, so there is nothing maintained to ask.
    const r = vault.runQuery('Task(p, s, t, l), Heading(p, d, ht, hl)')
    expect(r.error).toBeNull()
    expect(r.writable).toContain('t')
    const row = r.rows[0]!
    const source = 'Task(p, s, t, l), Heading(p, d, ht, hl)'
    expect(vault.resolveUpdate(source, row, 't', 'x').rel).toBe('MdNodeText')
  })
})
