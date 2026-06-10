// One continuous view: rendered markdown that is also the editor, with no
// open/close sensation. Clicking a block swaps it for an in-flow source
// editor with the caret where you clicked; Enter at the end of a paragraph
// commits and keeps writing in a fresh block below; arrow keys walk the
// caret across block boundaries like one document. Committing splices the
// draft back into the note through the optimistic save, so blocks re-render
// instantly. Interactive elements (links, checkboxes, dataview cells) keep
// their own behaviour and never enter edit mode.
//
// Block positions come from remark `node.position` in plain markdown; in
// MDX (where compiled JSX passes no node prop) they arrive as
// data-block-start/end attributes stamped by remarkBlockPositions — including
// on JSX components like <Kanban/>, which makes those blocks editable too.
//
// The flow-md behaviours from before all still apply: datalog-query fences
// render live DataViews (✎ in the footer edits the fence), datalog fences
// render as rule blocks, checkboxes toggle through the notes collection,
// wiki links resolve, frontmatter shows as an editable chip, and a trailing
// "+" appends a block.
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
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  insertBlock,
  replaceLines,
  sliceLines,
} from '../lib/blocks.js'
import { saveNote, toggleTask } from '../lib/db.js'
import { remarkWikiLinks, resolveWikiTarget } from '../lib/wiki.js'
import { type BlockKind, BlockEditor } from './BlockEditor.js'
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

interface Editing {
  range: BlockRange
  /** Caret offset into the block source; -1 = end. */
  caret: number
  /** True when the range is an insertion point (start = end + 1). */
  insert?: boolean
}

interface MdContext {
  content: string
  queries: QueryResult[]
  files: readonly string[]
  onToggle: (line: number, checked: boolean) => void
  editing: Editing | null
  beginEdit: (range: BlockRange, caret?: number) => void
  commitEdit: (editing: Editing, draft: string) => void
  /** Commit, then keep writing in a fresh block right below. */
  continueBelow: (editing: Editing, draft: string) => void
  /** Commit if dirty, then move the caret into the neighbouring block. */
  navigate: (editing: Editing, draft: string, dir: 'up' | 'down') => void
  cancelEdit: () => void
  /** Blocks announce their ranges so navigation knows the document order. */
  register: (range: BlockRange) => () => void
  /** True when this block (or the document tail) should render the active
   *  insertion editor directly above itself. */
  insertHost: (mine: BlockRange | 'tail') => boolean
}

const noop = () => {}
const Ctx = createContext<MdContext>({
  content: '',
  queries: [],
  files: [],
  onToggle: noop,
  editing: null,
  beginEdit: noop,
  commitEdit: noop,
  continueBelow: noop,
  navigate: noop,
  cancelEdit: noop,
  register: () => noop,
  insertHost: () => false,
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
  const [editing, setEditing] = useState<Editing | null>(null)
  const blocks = useRef(new Map<string, BlockRange>())

  const register = useCallback((range: BlockRange) => {
    const key = `${range.start}:${range.end}`
    blocks.current.set(key, range)
    return () => {
      blocks.current.delete(key)
    }
  }, [])

  const ctx = useMemo<MdContext>(() => {
    const report = (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err))
    const save = (next: string) =>
      saveNote(path, next).then(() => setError(null), report)

    /** Apply a draft to the note; returns the committed block's last line
     *  (in the *new* content) and the line-count delta, for follow-ups. */
    const apply = (
      e: Editing,
      draft: string,
    ): { lastLine: number; delta: number } => {
      if (e.insert || e.range.start < 1) {
        if (draft.trim() === '') {
          return { lastLine: Math.max(e.range.end, 0), delta: 0 }
        }
        const after = e.range.start < 1 ? content.split('\n').length : e.range.start - 1
        const r =
          e.range.start < 1
            ? (() => {
                const next = replaceLines(content, APPEND, draft)
                const lastLine = next.split('\n').length - 1
                void save(next)
                return { lastLine, delta: lastLine - after }
              })()
            : (() => {
                const { content: next, range } = insertBlock(content, after, draft)
                void save(next)
                return { lastLine: range.end, delta: range.end - after }
              })()
        return r
      }
      const oldLines = e.range.end - e.range.start + 1
      const newLines = draft === '' ? 0 : draft.split('\n').length
      void save(replaceLines(content, e.range, draft))
      return { lastLine: e.range.start - 1 + newLines, delta: newLines - oldLines }
    }

    const isDirty = (e: Editing, draft: string) =>
      draft !== (e.insert || e.range.start < 1 ? '' : sliceLines(content, e.range))

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
      beginEdit: (range, caret = -1) => setEditing({ range, caret }),
      cancelEdit: () => setEditing(null),
      register,
      commitEdit: (e, draft) => {
        setEditing(null)
        if (isDirty(e, draft)) apply(e, draft)
      },
      continueBelow: (e, draft) => {
        const { lastLine } = apply(e, draft)
        setEditing({
          range: { start: lastLine + 1, end: lastLine },
          caret: 0,
          insert: true,
        })
      },
      insertHost: (mine) => {
        if (!editing || !(editing.insert || editing.range.start < 1)) return false
        const at = editing.range.start
        if (mine === 'tail') {
          if (at < 1) return true
          for (const b of blocks.current.values()) {
            if (b.start >= at) return false
          }
          return true
        }
        if (at < 1 || mine.start < at) return false
        for (const b of blocks.current.values()) {
          if (b.start >= at && b.start < mine.start) return false
        }
        return true
      },
      navigate: (e, draft, dir) => {
        const dirty = isDirty(e, draft)
        const { delta } = dirty ? apply(e, draft) : { delta: 0 }
        const sorted = [...blocks.current.values()].sort((a, b) => a.start - b.start)
        const target =
          dir === 'down'
            ? sorted.find((b) => b.start > e.range.end)
            : [...sorted].reverse().find((b) => b.end < e.range.start)
        if (!target) {
          // Walking down past the last block keeps writing (append editor).
          setEditing(
            dir === 'down' ? { range: APPEND, caret: 0, insert: true } : null,
          )
          return
        }
        const shift = dirty && target.start > e.range.start ? delta : 0
        setEditing({
          range: { start: target.start + shift, end: target.end + shift },
          caret: dir === 'down' ? 0 : -1,
        })
      },
    }
  }, [path, content, queries, files, editing, register])

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

interface PositionedNode {
  position?: { start: { line: number }; end: { line: number } }
}

/** Block range from remark positions (markdown) or the data attributes
 *  remarkBlockPositions stamps for MDX. */
export function rangeFrom(
  node: PositionedNode | undefined,
  props?: Record<string, unknown>,
): BlockRange | null {
  const start = node?.position?.start.line ?? Number(props?.['data-block-start'] ?? 0)
  const end = node?.position?.end.line ?? Number(props?.['data-block-end'] ?? 0)
  return start && end ? { start, end } : null
}

const sameRange = (a: BlockRange, b: BlockRange) =>
  a.start === b.start && a.end === b.end

/** Caret offset of the current selection inside `el`'s rendered text — set
 *  by the click that is about to open the editor. Markup characters make
 *  this approximate for formatted text; exact for plain text. */
function clickCaret(el: Element): number {
  const sel = window.getSelection()
  if (!sel?.focusNode || !el.contains(sel.focusNode)) return -1
  const range = document.createRange()
  range.selectNodeContents(el)
  range.setEnd(sel.focusNode, sel.focusOffset)
  return range.toString().length
}

/** The active insertion editor (a fresh block being written between
 *  existing ones, or at the tail). Hosted by whichever block insertHost
 *  picks. */
function InsertionEditor() {
  const { editing, commitEdit, continueBelow, navigate, cancelEdit } = useContext(Ctx)
  if (!editing) return null
  return (
    <BlockEditor
      initial=""
      caret={0}
      kind="flow"
      placeholder="write…"
      onCommit={(draft) => commitEdit(editing, draft)}
      onCancel={cancelEdit}
      onContinue={(draft) => continueBelow(editing, draft)}
      onNavigate={(dir, draft) => navigate(editing, draft, dir)}
    />
  )
}

/** The inline editor for `range` when it's the active block, else null.
 *  Also registers the block for arrow-key navigation. */
function useBlockEditor(range: BlockRange | null, kind: BlockKind): ReactNode | null {
  const { content, editing, commitEdit, continueBelow, navigate, cancelEdit, register } =
    useContext(Ctx)
  const start = range?.start ?? 0
  const end = range?.end ?? 0
  useEffect(() => {
    if (start && end) return register({ start, end })
    return undefined
  }, [register, start, end])
  if (!range || !editing || editing.insert || !sameRange(editing.range, range)) {
    return null
  }
  return (
    <BlockEditor
      initial={sliceLines(content, range)}
      caret={editing.caret}
      kind={kind}
      onCommit={(draft) => commitEdit(editing, draft)}
      onCancel={cancelEdit}
      onContinue={(draft) => continueBelow(editing, draft)}
      onNavigate={(dir, draft) => navigate(editing, draft, dir)}
    />
  )
}

interface BlockProps {
  node?: PositionedNode
  children?: ReactNode
  className?: string
}

const FLOW_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** Wrap a plain block element so clicking it (outside interactive children)
 *  swaps it for the in-flow source editor, caret at the click point. */
function editable(
  Tag: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'blockquote' | 'table',
) {
  function EditableBlock({ node, children, className, ...rest }: BlockProps) {
    const { beginEdit, insertHost } = useContext(Ctx)
    const range = rangeFrom(node, rest as Record<string, unknown>)
    const editor = useBlockEditor(range, FLOW_TAGS.has(Tag) ? 'flow' : 'verbatim')
    const hostsInsert = range ? insertHost(range) : false
    if (editor) return <>{editor}</>
    const onClick = (e: ReactMouseEvent) => {
      if (range && !isInteractive(e.target)) {
        beginEdit(range, clickCaret(e.currentTarget))
      }
    }
    return (
      <>
        {hostsInsert && <InsertionEditor />}
        <Tag
          className={className ? `${className} ${styles.block}` : styles.block}
          onClick={onClick}
        >
          {children}
        </Tag>
      </>
    )
  }
  EditableBlock.displayName = `Editable(${Tag})`
  return EditableBlock
}

function FrontmatterChip() {
  const { content, beginEdit } = useContext(Ctx)
  const range = useMemo(() => frontmatterRange(content), [content])
  const editor = useBlockEditor(range, 'verbatim')
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
  const { beginEdit, insertHost } = useContext(Ctx)
  if (insertHost('tail')) return <InsertionEditor />
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
  const { queries, beginEdit, insertHost } = useContext(Ctx)
  const child = Children.toArray(children)[0]
  const childProps = isValidElement<{
    className?: string
    children?: ReactNode
  }>(child)
    ? (child.props as Record<string, unknown>)
    : undefined
  const range = rangeFrom(node, childProps)
  const editor = useBlockEditor(range, 'verbatim')
  const hostsInsert = range ? insertHost(range) : false
  if (editor) return <>{editor}</>

  let body: ReactNode
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const cls = child.props.className ?? ''
    const source = String(child.props.children ?? '')
    if (cls.includes('language-datalog-query')) {
      const line = range?.start ?? 0
      const match =
        queries.find((q) => q.line === line) ??
        queries.find((q) => q.source.trim() === source.trim())
      body = (
        <DataView
          source={source}
          result={match ?? null}
          onEditSource={range ? () => beginEdit(range) : undefined}
        />
      )
    } else if (cls.includes('language-datalog')) {
      body = (
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
  body ??= (
    <pre className={styles.block} onClick={() => range && beginEdit(range)}>
      {children}
    </pre>
  )
  return (
    <>
      {hostsInsert && <InsertionEditor />}
      {body}
    </>
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

/** Wrap an MDX registry component (Kanban, Graph, …) so the JSX block it
 *  came from is editable too — remarkBlockPositions hands the component its
 *  own source range as data attributes. */
export function editableJsx<P extends object>(
  Comp: React.ComponentType<P>,
): React.ComponentType<P> {
  function EditableJsx(props: P & Record<string, unknown>) {
    const { beginEdit } = useContext(Ctx)
    const range = rangeFrom(undefined, props)
    const editor = useBlockEditor(range, 'verbatim')
    if (editor) return <>{editor}</>
    return (
      <div className={styles.jsxBlock}>
        <Comp {...props} />
        {range && (
          <button
            type="button"
            className={styles.jsxEdit}
            title="edit component source"
            data-testid="jsx-edit"
            onClick={() => beginEdit(range)}
          >
            ✎
          </button>
        )}
      </div>
    )
  }
  EditableJsx.displayName = `EditableJsx(${Comp.displayName ?? Comp.name})`
  return EditableJsx as React.ComponentType<P>
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
