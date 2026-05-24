// Spike: prove the flow-ts integration end to end before building real layers.
//
// Validates the assumptions flow-md is built on:
//   1. A schema-only program (EDB .decls with no `.input`) parses.
//   2. String-typed columns and string constants in rule bodies work.
//   3. openSession + update + advance delivers IDB rows to the sink.
//   4. Recursion (transitive reachability) converges.
//   5. Incremental retraction (diff -1) propagates through the IDB.

import { parseProgram } from '@flow-ts/parsing'
import { type Row, openSession } from 'flow-ts'
import { describe, expect, it } from 'vitest'

const PROGRAM = `
.in
.decl File(path: string)
.decl Tag(path: string, tag: string)
.decl Link(src: string, dst: string)
.printsize
.decl ProjectFile(path: string)
.decl Reach(a: string, b: string)
.rule
ProjectFile(p) :- Tag(p, "project").
Reach(a, b) :- Link(a, b).
Reach(a, c) :- Reach(a, b), Link(b, c).
`

/** Collect sink diffs into a multiset keyed by relation + row, summing
 *  multiplicities. Returns the rows whose net multiplicity is positive. */
function makeSink() {
  const counts = new Map<string, { rel: string; row: Row; mult: number }>()
  const sink = (relation: string, row: Row, mult: number) => {
    const key = `${relation} ${JSON.stringify(row)}`
    const prev = counts.get(key)
    counts.set(key, { rel: relation, row, mult: (prev?.mult ?? 0) + mult })
  }
  const live = (relation: string): unknown[][] =>
    [...counts.values()]
      .filter((e) => e.mult > 0 && e.rel === relation)
      .map((e) => [...e.row])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return { sink, live }
}

describe('flow-ts integration spike', () => {
  it('runs schema EDBs, a string-constant query, and recursion', () => {
    const program = parseProgram(PROGRAM)
    const { sink, live } = makeSink()
    const session = openSession(program, {}, sink)

    session.update('File', ['a.md'])
    session.update('File', ['b.md'])
    session.update('Tag', ['a.md', 'project'])
    session.update('Tag', ['b.md', 'note'])
    session.update('Link', ['a.md', 'b.md'])
    session.update('Link', ['b.md', 'c.md'])
    session.advance()

    expect(live('ProjectFile')).toEqual([['a.md']])
    expect(live('Reach')).toEqual([
      ['a.md', 'b.md'],
      ['a.md', 'c.md'],
      ['b.md', 'c.md'],
    ])

    // Incrementally retract the a->b edge; a should no longer reach b or c.
    session.update('Link', ['a.md', 'b.md'], -1)
    session.advance()
    expect(live('Reach')).toEqual([['b.md', 'c.md']])

    session.close()
  })
})
