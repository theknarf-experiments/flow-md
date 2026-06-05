import { markdownPlugin } from '@flow-md/plugin-markdown'
import { describe, expect, it } from 'vitest'
import { Vault } from '../src/vault.js'

const plugins = [markdownPlugin]

// Built from line arrays because a ``` fence inside a backtick template
// literal would terminate the template.
function md(...lines: string[]): string {
  return lines.join('\n')
}

const NOTE_A = md(
  '---',
  'tags: [project]',
  '---',
  '# A',
  '',
  '```datalog',
  'ProjectFile(p) :- Tag(p, "project").',
  '```',
  '',
  '```datalog-query',
  'ProjectFile(p)',
  '```',
)

const NOTE_B_PROJECT = md('---', 'tags: [project]', '---', '# B')
const NOTE_B_PLAIN = md('---', 'tags: [misc]', '---', '# B')

function projectQuery(vault: Vault) {
  const qs = vault.queries('notes/a.md')
  expect(qs).toHaveLength(1)
  return qs[0]!
}

describe('Vault', () => {
  it('builds a session and answers an embedded query', () => {
    const vault = new Vault(plugins)
    vault.setFile('notes/a.md', NOTE_A, 1)
    vault.advance()

    const q = projectQuery(vault)
    expect(q.columns).toEqual(['p'])
    expect(q.rows).toEqual([['notes/a.md']])
    expect(vault.error()).toBeNull()
  })

  it('incrementally folds a new content-only file into an existing query', () => {
    const vault = new Vault(plugins)
    vault.setFile('notes/a.md', NOTE_A, 1)
    vault.advance()

    // b.md has no rules/queries — its Tag fact should stream into A's query.
    vault.setFile('notes/b.md', NOTE_B_PROJECT, 1)
    vault.advance()

    expect(projectQuery(vault).rows.sort()).toEqual([
      ['notes/a.md'],
      ['notes/b.md'],
    ])
  })

  it('retracts facts when a file stops matching, and on removal', () => {
    const vault = new Vault(plugins)
    vault.setFile('notes/a.md', NOTE_A, 1)
    vault.setFile('notes/b.md', NOTE_B_PROJECT, 1)
    vault.advance()
    expect(projectQuery(vault).rows).toHaveLength(2)

    // Re-tag b.md away from "project": incremental retraction.
    vault.setFile('notes/b.md', NOTE_B_PLAIN, 2)
    vault.advance()
    expect(projectQuery(vault).rows).toEqual([['notes/a.md']])

    // Remove a.md's source entirely.
    vault.removeFile('notes/a.md')
    vault.advance()
    expect(vault.queries()).toHaveLength(0)
  })

  it('rebuilds the program when a rule block changes', () => {
    const vault = new Vault(plugins)
    vault.setFile('notes/a.md', NOTE_A, 1)
    vault.advance()
    expect(projectQuery(vault).rows).toEqual([['notes/a.md']])

    // Point the rule at a tag nobody has → query goes empty after rebuild.
    const retargeted = NOTE_A.replace('"project"', '"urgent"')
    vault.setFile('notes/a.md', retargeted, 2)
    vault.advance()
    expect(projectQuery(vault).rows).toEqual([])
  })

  it('reports a build error for a malformed query without throwing', () => {
    const vault = new Vault(plugins)
    vault.setFile(
      'notes/bad.md',
      md('```datalog-query', 'this is not (valid datalog', '```'),
      1,
    )
    vault.advance()
    expect(vault.error()).not.toBeNull()
  })

  it('runs one-off ad-hoc queries against current rules and facts', () => {
    const vault = new Vault(plugins)
    vault.setFile('notes/a.md', NOTE_A, 1)
    vault.setFile('notes/b.md', NOTE_B_PROJECT, 1)
    vault.advance()

    // ProjectFile is an IDB defined by a rule in NOTE_A.
    const r = vault.runQuery('ProjectFile(p)')
    expect(r.error).toBeNull()
    expect(r.columns).toEqual(['p'])
    expect(r.rows.map((row) => row[0]).sort()).toEqual([
      'notes/a.md',
      'notes/b.md',
    ])

    // A malformed query reports an error instead of throwing.
    expect(vault.runQuery('this is (not valid').error).not.toBeNull()
  })
})
