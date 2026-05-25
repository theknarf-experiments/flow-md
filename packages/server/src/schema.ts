// The fixed EDB schema: the set of relations flow-md derives from markdown
// structure. Every markdown file in the vault contributes rows to these.
// User `​```datalog` blocks define IDBs *on top* of this schema.

export type DataType = 'string' | 'number' | 'float'

export interface EdbDef {
  name: string
  attrs: Array<[name: string, type: DataType]>
}

export const EDB_SCHEMA: EdbDef[] = [
  { name: 'File', attrs: [['path', 'string'], ['mtime', 'number']] },
  {
    name: 'Heading',
    attrs: [
      ['path', 'string'],
      ['level', 'number'],
      ['text', 'string'],
      ['line', 'number'],
    ],
  },
  {
    name: 'Link',
    attrs: [['src', 'string'], ['dst', 'string'], ['kind', 'string']],
  },
  { name: 'Tag', attrs: [['path', 'string'], ['tag', 'string']] },
  {
    name: 'Frontmatter',
    attrs: [['path', 'string'], ['key', 'string'], ['value', 'string']],
  },
  {
    name: 'FrontmatterNumber',
    attrs: [['path', 'string'], ['key', 'string'], ['num', 'float']],
  },
  {
    name: 'CodeBlock',
    attrs: [['path', 'string'], ['lang', 'string'], ['line', 'number']],
  },
  {
    // GFM task-list items: status is "open" (- [ ]) or "closed" (- [x]).
    name: 'Task',
    attrs: [
      ['path', 'string'],
      ['status', 'string'],
      ['text', 'string'],
      ['line', 'number'],
    ],
  },
]

/** Relation names that are EDBs — used to tell schema relations apart from
 *  user-defined IDB heads when inferring IDB declarations. */
export const EDB_NAMES: ReadonlySet<string> = new Set(
  EDB_SCHEMA.map((e) => e.name),
)

/** The `.in` section declaring every EDB, for program assembly. */
export function edbSectionText(): string {
  const decls = EDB_SCHEMA.map((e) => {
    const attrs = e.attrs.map(([n, t]) => `${n}: ${t}`).join(', ')
    return `.decl ${e.name}(${attrs})`
  })
  return `.in\n${decls.join('\n')}`
}
