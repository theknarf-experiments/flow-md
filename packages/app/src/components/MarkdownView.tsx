// One coherent view: rendered markdown that is also the editor. Every block
// (paragraph, heading, list, quote, table, code fence) knows its source line
// range from remark positions; clicking a block swaps it for an inline
// source editor (BlockEditor), and committing splices the draft back into
// the note through the optimistic save path — so the block re-renders
// instantly. Interactive elements (links, checkboxes, dataview cells) keep
// their own behaviour; clicks on them never enter edit mode.
//
// On top of that, the flow-md behaviours from before:
//
//   • `datalog-query` fences render as live DataView tables (matched to the
//     server's QueryResult by fence line) with a ✎ in the footer to edit the
//     query source; `datalog` fences render as styled rule blocks.
//   • Task checkboxes toggle optimistically through the notes collection.
//   • `[[wiki links]]` become router links, resolved against the file list.
//   • Frontmatter renders as a collapsed chip above the note — click to
//     edit it as text, instead of being invisible like before.
//   • A trailing "+" affordance appends a new block to the note.
//
// The component overrides are module-level and read their dynamic inputs
// from context. This is load-bearing, not style: inline closures would get a
// new function identity on every poll-driven re-render, which React treats
// as a new component type — unmounting every DataView and wiping its state
// (sort order, open cell editor, error banner) every few seconds.

import { Link } from '@tanstack/react-router'
import type { Root } from 'mdast'
import {
  Children,
  type MouseEvent as ReactMouseEvent,
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
import {
  APPEND,
  type BlockRange,
  frontmatterRange,
  frontmatterSummary,
  replaceLines,
  sliceLines,
} from '../lib/blocks.js'
import { saveNote, toggleTask } from '../lib/db.js'
import { remarkWikiLinks, resolveWikiTarget } from '../lib/wiki.js'
import { BlockEditor } from './BlockEditor.js'
import { DataView } from './DataView.js'
import styles from './MarkdownView.module.css'

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

/** Shared by MarkdownView and MdxView — the remark pipeline is identical. */
export const MD_PLUGINS = [
  remarkGfm,
  [remarkFrontmatter, ['yaml']],
  remarkWikiLinks,
  remarkTaskLines,
] as const

interface MdContext {
  content: string
  queries: QueryResult[]
  files: readonly string[]
  onToggle: (line: number, checked: boolean) => void
  /** Block currently being edited (or APPEND), null when just reading. */
  editing: BlockRange | null
  beginEdit: (range: BlockRange) => void
  commitEdit: (range: BlockRange, draft: string) => void
  cancelEdit: () => void
}

const Ctx = createContext<MdContext>({
  content: '',
  queries: [],
  files: [],
  onToggle: () => {},
  editing: null,
  beginEdit: () => {},
  commitEdit: () => {},
  cancelEdit: () => {},
})

/** Context + error banner + frontmatter chip + append affordance around any
 *  markdown-ish renderer (plain markdown or evaluated MDX). */
export function MdProvider(props: {
  path: string
  content: string
  queries: QueryResult[]
  files: readonly string[]
  children: ReactNode
}) {
  const { path, content, queries, files, children } = props
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<BlockRange | null>(null)

  const ctx = useMemo<MdContext>(() => {
    const report = (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err))
    return {
      content,
      queries,
      files,
      onToggle: (line, checked) => {
        // Optimistic: the content re-renders with the flipped box
        // immediately; a failed save rolls back and we surface the reason.
        toggleTask(path, line, checked).then(() => setError(null), report)
      },
      editing,
      beginEdit: setEditing,
      commitEdit: (range, draft) => {
        setEditing(null)
        saveNote(path, replaceLines(content, range, draft)).then(
          () => setError(null),
          report,
        )
      },
      cancelEdit: () => setEditing(null),
    }
  }, [path, content, queries, files, editing])

  return (
    <div className={styles.markdown}>
      {error && <p className="offline">{error}</p>}
      <Ctx.Provider value={ctx}>
        <FrontmatterChip />
        {children}
        <AppendBlock />
      </Ctx.Provider>
    </div>
  )
}

export function MarkdownView(props: {
  path: string
  content: string
  queries: QueryResult[]
  files: readonly string[]
}) {
  const { path, content, queries, files } = props
  return (
    <MdProvider path={path} content={content} queries={queries} files={files}>
      <Markdown
        remarkPlugins={MD_PLUGINS as never}
        components={MD_COMPONENTS}
        urlTransform={(url) => url}
      >
        {content}
      </Markdown>
    </MdProvider>
  )
}

// --- block editing -------------------------------------------------------------

/** True when a click landed on something with its own behaviour. */
function isInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('a, button, input, textarea, select, summary')
  )
}

function rangeOf(node?: {
  position?: { start: { line: number }; end: { line: number } }
}): BlockRange | null {
  const start = node?.position?.start.line
  const end = node?.position?.end.line
  return start && end ? { start, end } : null
}

const sameRange = (a: BlockRange | null, b: BlockRange | null) =>
  !!a && !!b && a.start === b.start && a.end === b.end

/** Either the inline editor for this block, or null when not editing it. */
function useBlockEditor(range: BlockRange | null): ReactNode | null {
  const { content, editing, commitEdit, cancelEdit } = useContext(Ctx)
  if (!range || !sameRange(editing, range)) return null
  return (
    <BlockEditor
      initial={sliceLines(content, range)}
      onCommit={(draft) => commitEdit(range, draft)}
      onCancel={cancelEdit}
    />
  )
}

interface BlockProps {
  node?: { position?: { start: { line: number }; end: { line: number } } }
  children?: ReactNode
  className?: string
}

/** Wrap a plain block element so clicking it (outside interactive children)
 *  swaps it for the inline source editor. */
function editable(Tag: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'blockquote' | 'table') {
  function EditableBlock({ node, children, className }: BlockProps) {
    const { beginEdit } = useContext(Ctx)
    const range = rangeOf(node)
    const editor = useBlockEditor(range)
    if (editor) return <>{editor}</>
    const onClick = (e: ReactMouseEvent) => {
      if (range && !isInteractive(e.target)) beginEdit(range)
    }
    return (
      <Tag
        className={className ? `${className} ${styles.block}` : styles.block}
        onClick={onClick}
      >
        {children}
      </Tag>
    )
  }
  EditableBlock.displayName = `Editable(${Tag})`
  return EditableBlock
}

function FrontmatterChip() {
  const { content, beginEdit } = useContext(Ctx)
  const range = useMemo(() => frontmatterRange(content), [content])
  const editor = useBlockEditor(range)
  if (editor) return <>{editor}</>
  if (!range) return null
  return (
    <button
      type="button"
      className={styles.frontmatter}
      title="edit frontmatter"
      onClick={() => beginEdit(range)}
      data-testid="frontmatter-chip"
    >
      ⋯ {frontmatterSummary(content, range) || 'frontmatter'}
    </button>
  )
}

function AppendBlock() {
  const { beginEdit } = useContext(Ctx)
  const editor = useBlockEditor(APPEND)
  if (editor) return <>{editor}</>
  return (
    <button
      type="button"
      className={styles.append}
      title="add a block at the end"
      onClick={() => beginEdit(APPEND)}
      data-testid="append-block"
    >
      +
    </button>
  )
}

// --- stable component overrides ----------------------------------------------

const PreBlock: Components['pre'] = ({ node, children }) => {
  const { queries, beginEdit } = useContext(Ctx)
  const range = rangeOf(node)
  const editor = useBlockEditor(range)
  if (editor) return <>{editor}</>

  const child = Children.toArray(children)[0]
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const cls = child.props.className ?? ''
    const source = String(child.props.children ?? '')
    if (cls.includes('language-datalog-query')) {
      const line = node?.position?.start.line ?? 0
      const match =
        queries.find((q) => q.line === line) ??
        queries.find((q) => q.source.trim() === source.trim())
      return (
        <DataView
          source={source}
          result={match ?? null}
          onEditSource={range ? () => beginEdit(range) : undefined}
        />
      )
    }
    if (cls.includes('language-datalog')) {
      return (
        <pre
          className={`${styles.ruleBlock} ${styles.block}`}
          onClick={() => range && beginEdit(range)}
        >
          <span className={styles.blockTag}>rules</span>
          {children}
        </pre>
      )
    }
  }
  return (
    <pre className={styles.block} onClick={() => range && beginEdit(range)}>
      {children}
    </pre>
  )
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
        <Link to="/note/$" params={{ _splat: resolved }} className={styles.wiki}>
          {children}
        </Link>
      )
    }
    return <span className={`${styles.wiki} ${styles.broken}`}>{children}</span>
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

export const MD_COMPONENTS: Components = {
  pre: PreBlock,
  li: ListItem,
  a: Anchor,
  p: editable('p') as Components['p'],
  h1: editable('h1') as Components['h1'],
  h2: editable('h2') as Components['h2'],
  h3: editable('h3') as Components['h3'],
  h4: editable('h4') as Components['h4'],
  h5: editable('h5') as Components['h5'],
  h6: editable('h6') as Components['h6'],
  ul: editable('ul') as Components['ul'],
  ol: editable('ol') as Components['ol'],
  blockquote: editable('blockquote') as Components['blockquote'],
  table: editable('table') as Components['table'],
}
