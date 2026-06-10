// CodeMirror widgets for the live editor. Two flavours:
//
//   • CheckboxWidget — plain DOM (an <input>), toggling rewrites the task
//     marker characters in the doc, which flows through the debounced save.
//   • ReactWidget subclasses — host a React root inside the editor for the
//     rich blocks: live dataviews and editable Tanstack tables. Widgets find
//     their *current* document position at interaction time via posAtDOM, so
//     edits elsewhere in the note can never make them splice a stale range.
//
// All widgets report eq() so CodeMirror reuses their DOM across decoration
// rebuilds — a React root that remounted on every keystroke would lose its
// state (open cell editors, sort order) and thrash.

import { evaluate } from '@mdx-js/mdx'
import { syntaxTree } from '@codemirror/language'
import { EditorView, WidgetType } from '@codemirror/view'
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { type ComponentType, type ReactNode, useEffect, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import * as runtime from 'react/jsx-runtime'
import { queriesCollection } from '../../lib/db.js'
import { type MdTable, parseMdTable, serializeMdTable } from '../../lib/mdtable.js'
import { DataView } from '../DataView.js'
import { Graph } from '../Graph.js'
import { Kanban } from '../Kanban.js'
import { MdTableGrid } from './MdTableGrid.js'
import widgetStyles from './widgets.module.css'

// --- checkbox ------------------------------------------------------------------

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-task-box'
    box.onmousedown = (e) => e.preventDefault() // keep editor selection
    box.onclick = (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(box)
      const marker = view.state.doc.sliceString(pos, pos + 3)
      if (marker !== '[ ]' && marker.toLowerCase() !== '[x]') return
      view.dispatch({
        changes: { from: pos, to: pos + 3, insert: this.checked ? '[ ]' : '[x]' },
      })
    }
    return box
  }

  override ignoreEvent(): boolean {
    return true
  }
}

// --- React hosting ---------------------------------------------------------------

abstract class ReactWidget extends WidgetType {
  private root: Root | null = null

  abstract render(view: EditorView, dom: HTMLElement): ReactNode

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-react-widget'
    this.root = createRoot(dom)
    this.root.render(this.render(view, dom))
    return dom
  }

  override destroy(dom: HTMLElement): void {
    // Defer: CodeMirror may destroy widgets during a React render pass, and
    // unmounting a root synchronously from inside one is an error.
    const root = this.root
    this.root = null
    if (root) setTimeout(() => root.unmount(), 0)
    void dom
  }

  override ignoreEvent(): boolean {
    return true
  }
}

// --- dataview fence ---------------------------------------------------------------

/** Live dataview replacing a ```datalog-query fence. Subscribes to the
 *  queries collection itself, so results stream in without the widget being
 *  rebuilt; the footer ✎ moves the caret into the fence, revealing source. */
export class DataViewWidget extends ReactWidget {
  constructor(
    readonly path: string,
    readonly source: string,
  ) {
    super()
  }

  override eq(other: DataViewWidget): boolean {
    return other.path === this.path && other.source === this.source
  }

  render(view: EditorView, dom: HTMLElement): ReactNode {
    return (
      <LiveDataView
        path={this.path}
        source={this.source}
        onEditSource={() => {
          const pos = view.posAtDOM(dom)
          const line = view.state.doc.lineAt(pos)
          view.dispatch({ selection: { anchor: line.to } })
          view.focus()
        }}
      />
    )
  }
}

function LiveDataView(props: {
  path: string
  source: string
  onEditSource: () => void
}) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ qr: queriesCollection })
        .where(({ qr }) => eq(qr.path, props.path)),
    [props.path],
  )
  const match = (data ?? []).find(
    (q) => q.source.trim() === props.source.trim(),
  )
  return (
    <DataView
      source={props.source}
      result={match ?? null}
      onEditSource={props.onEditSource}
    />
  )
}

// --- tables ------------------------------------------------------------------------

/** Editable Tanstack-Table grid replacing a pipe table. Commits re-serialize
 *  the table and splice exactly its source range, located at commit time. */
export class TableWidget extends ReactWidget {
  constructor(readonly source: string) {
    super()
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source
  }

  render(view: EditorView, dom: HTMLElement): ReactNode {
    const table = parseMdTable(this.source)
    if (!table) return <pre>{this.source}</pre>
    const commit = (next: MdTable) => {
      const range = tableRangeAt(view, dom)
      if (!range) return
      view.dispatch({
        changes: { ...range, insert: serializeMdTable(next) },
      })
    }
    return (
      <MdTableGrid
        table={table}
        onCommit={commit}
        onEditSource={() => {
          const range = tableRangeAt(view, dom)
          if (!range) return
          view.dispatch({ selection: { anchor: range.from } })
          view.focus()
        }}
      />
    )
  }
}

// --- JSX blocks (MDX) ---------------------------------------------------------

/** Components MDX notes can use without importing. */
const REGISTRY = { Kanban, Graph }

/** Compile one JSX/MDX snippet to a component, cached by source — widgets
 *  rebuild on every decoration pass, the compiler shouldn't run again. */
const compiled = new Map<string, Promise<ComponentType<{ components?: object }>>>()
function compileJsx(source: string) {
  let p = compiled.get(source)
  if (!p) {
    p = evaluate(source, { ...runtime }).then(
      (mod) => mod.default as ComponentType<{ components?: object }>,
    )
    compiled.set(source, p)
    p.catch(() => compiled.delete(source)) // don't cache failures
  }
  return p
}

/** A JSX block in an MDX note: renders the evaluated component while the
 *  caret is elsewhere; a hover ✎ (or clicking into the block) reveals the
 *  raw JSX for text editing. */
export class JsxWidget extends ReactWidget {
  constructor(readonly source: string) {
    super()
  }

  override eq(other: JsxWidget): boolean {
    return other.source === this.source
  }

  render(view: EditorView, dom: HTMLElement): ReactNode {
    return (
      <JsxBlock
        source={this.source}
        onEdit={() => {
          const pos = view.posAtDOM(dom)
          view.dispatch({ selection: { anchor: pos } })
          view.focus()
        }}
      />
    )
  }
}

function JsxBlock(props: { source: string; onEdit: () => void }) {
  const { source, onEdit } = props
  const [state, setState] = useState<{
    Comp: ComponentType<{ components?: object }> | null
    error: string | null
  }>({ Comp: null, error: null })

  useEffect(() => {
    let alive = true
    compileJsx(source).then(
      (Comp) => alive && setState({ Comp, error: null }),
      (err: unknown) =>
        alive &&
        setState({
          Comp: null,
          error: err instanceof Error ? err.message : String(err),
        }),
    )
    return () => {
      alive = false
    }
  }, [source])

  return (
    <div className={widgetStyles.jsx} data-testid="jsx-widget">
      {state.error && <p className="offline">jsx error: {state.error}</p>}
      {state.Comp && <state.Comp components={REGISTRY} />}
      {!state.Comp && !state.error && (
        <p className="hint">rendering component…</p>
      )}
      <button
        type="button"
        className={widgetStyles.jsxEdit}
        title="edit component source"
        data-testid="jsx-edit"
        onClick={onEdit}
      >
        ✎
      </button>
    </div>
  )
}

/** The Table syntax node currently rendered at this widget's position. */
function tableRangeAt(
  view: EditorView,
  dom: HTMLElement,
): { from: number; to: number } | null {
  const pos = view.posAtDOM(dom)
  let found: { from: number; to: number } | null = null
  syntaxTree(view.state).iterate({
    from: pos,
    to: Math.min(pos + 1, view.state.doc.length),
    enter(node) {
      if (node.name === 'Table') {
        found = { from: node.from, to: node.to }
        return false
      }
      return undefined
    },
  })
  return found
}
