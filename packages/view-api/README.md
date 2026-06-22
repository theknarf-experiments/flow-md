# @flow-md/view-api

The plugin contract for **flow-md view components** — React components,
driven by Datalog queries, that you can drop into an MDX note:

```mdx
<Kanban query="Task(path, status, text, line)" groupBy="status" />
```

A plugin's only dependency is this package. It never talks to the flow-md
server or imports app internals — everything it needs is on the **host**,
which the app provides.

## Writing a plugin

```tsx
import { type FlowMdViewPlugin, useQuery } from '@flow-md/view-api'

function Count({ query }: { query: string }) {
  const { rows, ready, error } = useQuery(query)
  if (error) return <p className="offline">{error}</p>
  if (!ready) return null
  return <strong>{rows.length} rows</strong>
}

export const countPlugin: FlowMdViewPlugin = {
  name: 'count',
  components: { Count },
}
```

Register the plugin in the app (`packages/app/src/plugins.ts`); its
`components` are merged into the MDX component registry, so `<Count query=.../>`
works in any `.mdx` note.

## The host

Reach it with `useFlowMd()` (or the `useQuery` / `useFiles` wrappers):

| Member                  | What it does                                            |
| ----------------------- | ------------------------------------------------------- |
| `useQuery(source, opts)`| live, polled result of an ad-hoc Datalog query          |
| `useFiles()`            | live list of vault note paths                           |
| `updateCell(args)`      | write a result cell back through the lineage update path|
| `resolveWiki(target)`   | resolve a wiki/link target to a vault path, or null     |
| `openNote(path)`        | navigate to a note                                      |

`useQuery`/`useFiles` are hooks — call them unconditionally at the top of
render. `QueryState` is `{ columns, rows, writable, error, ready, refresh }`.

## Styling

The host provides the app's theme as CSS variables (`--accent`, `--fg`,
`--fg-dim`, `--bg-raise`, `--border`, `--danger`, `--mono`, …) and the global
`.offline` / `.hint` utility classes. Lean on them and your component matches
the app; scope your own rules with CSS Modules.
