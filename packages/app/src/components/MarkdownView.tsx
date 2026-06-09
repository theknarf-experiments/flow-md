// Markdown rendering with the three flow-md behaviours layered on top of
// react-markdown + remark-gfm:
//
//   • `datalog-query` fences render as live DataView tables (matched to the
//     server's QueryResult by fence line, falling back to source text);
//     `datalog` fences render as styled rule blocks.
//   • Task checkboxes are enabled and toggle optimistically through the
//     notes collection. The task's source line travels on the <li> as
//     `data-line` (a remark plugin attaches it, since the checkbox <input>
//     itself is synthesised by the hast transform and carries no position).
//   • `[[wiki links]]` become router links, resolved against the file list.
//
// The component overrides are module-level and read their dynamic inputs
// from context. This is load-bearing, not style: inline closures would get a
// new function identity on every poll-driven re-render, which React treats
// as a new component type — unmounting every DataView and wiping its state
// (sort order, open cell editor, error banner) every few seconds.
//
// Frontmatter is parsed (so it doesn't render as a stray <hr>+text) and
// dropped from the output.

import { Link } from '@tanstack/react-router'
import type { Root } from 'mdast'
import {
  Children,
  type ReactNode,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useState,
} from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import type { QueryResult } from '../lib/api.js'
import { toggleTask } from '../lib/db.js'
import { remarkWikiLinks, resolveWikiTarget } from '../lib/wiki.js'
import { DataView } from './DataView.js'

/** Stamp each task-list item with its 1-based source line. */
function remarkTaskLines() {
  return (tree: Root) => {
    visit(tree, 'listItem', (node) => {
      if (typeof node.checked !== 'boolean') return
      const line = node.position?.start.line
      if (!line) return
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, 'data-line': line },
      }
    })
  }
}

const PLUGINS = [
  remarkGfm,
  [remarkFrontmatter, ['yaml']],
  remarkWikiLinks,
  remarkTaskLines,
] as const

interface MdContext {
  queries: QueryResult[]
  files: readonly string[]
  onToggle: (line: number, checked: boolean) => void
}

const Ctx = createContext<MdContext>({
  queries: [],
  files: [],
  onToggle: () => {},
})

export function MarkdownView(props: {
  path: string
  content: string
  queries: QueryResult[]
  files: readonly string[]
}) {
  const { path, content, queries, files } = props
  const [error, setError] = useState<string | null>(null)

  const ctx = useMemo<MdContext>(
    () => ({
      queries,
      files,
      onToggle: (line, checked) => {
        // Optimistic: the content re-renders with the flipped box
        // immediately; a failed save rolls back and we surface the reason.
        toggleTask(path, line, checked).then(
          () => setError(null),
          (err: unknown) =>
            setError(err instanceof Error ? err.message : String(err)),
        )
      },
    }),
    [path, queries, files],
  )

  return (
    <div className="markdown">
      {error && <p className="offline">{error}</p>}
      <Ctx.Provider value={ctx}>
        <Markdown
          remarkPlugins={PLUGINS as never}
          components={COMPONENTS}
          urlTransform={(url) => url}
        >
          {content}
        </Markdown>
      </Ctx.Provider>
    </div>
  )
}

// --- stable component overrides ----------------------------------------------

const PreBlock: Components['pre'] = ({ node, children }) => {
  const { queries } = useContext(Ctx)
  const child = Children.toArray(children)[0]
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const cls = child.props.className ?? ''
    const source = String(child.props.children ?? '')
    if (cls.includes('language-datalog-query')) {
      const line = node?.position?.start.line ?? 0
      const match =
        queries.find((q) => q.line === line) ??
        queries.find((q) => q.source.trim() === source.trim())
      return <DataView source={source} result={match ?? null} />
    }
    if (cls.includes('language-datalog')) {
      return (
        <pre className="rule-block">
          <span className="block-tag">rules</span>
          {children}
        </pre>
      )
    }
  }
  return <pre>{children}</pre>
}

const ListItem: Components['li'] = ({ node: _node, children, className, ...rest }) => {
  const { onToggle } = useContext(Ctx)
  const line = Number((rest as Record<string, unknown>)['data-line'] ?? 0)
  if (!className?.includes('task-list-item') || !line) {
    return <li className={className}>{children}</li>
  }
  const kids = Children.toArray(children)
  const box = kids.find(
    (k) => isValidElement<{ checked?: boolean }>(k) && k.type === 'input',
  )
  const checked = isValidElement<{ checked?: boolean }>(box)
    ? !!box.props.checked
    : false
  return (
    <li className={className}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(line, e.target.checked)}
      />
      {kids.filter((k) => k !== box)}
    </li>
  )
}

const Anchor: Components['a'] = ({ href, children }) => {
  const { files } = useContext(Ctx)
  if (href?.startsWith('wiki:')) {
    const target = decodeURIComponent(href.slice('wiki:'.length))
    const resolved = resolveWikiTarget(target, files)
    if (resolved) {
      return (
        <Link to="/note/$" params={{ _splat: resolved }} className="wiki">
          {children}
        </Link>
      )
    }
    return <span className="wiki broken">{children}</span>
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

const COMPONENTS: Components = {
  pre: PreBlock,
  li: ListItem,
  a: Anchor,
}
