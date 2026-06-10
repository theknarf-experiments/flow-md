// The Typora trick, on CodeMirror 6: the document is the markdown source,
// and decorations hide syntax until the caret touches a construct. Inline
// constructs (emphasis, links, inline code) reveal when the selection enters
// their exact range; block constructs (headings, fences, tables, quotes,
// frontmatter) reveal when the selection touches their lines. Replaced
// ranges are atomic, so arrowing over hidden `**` marks hops the caret into
// the text — exactly the editing feel Typora has.
//
// Rich blocks become widgets: ```datalog-query fences render live DataViews,
// pipe tables render editable Tanstack grids (see widgets.tsx), task markers
// render real checkboxes. Everything else is plain styled text.

import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language'
import {
  type EditorState,
  type Range,
  RangeSet,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import { tags as t } from '@lezer/highlight'
import { frontmatterRange, frontmatterSummary } from '../../lib/blocks.js'
import { scanJsxBlocks } from './jsx.js'
import {
  CheckboxWidget,
  DataViewWidget,
  JsxWidget,
  TableWidget,
} from './widgets.js'

export interface LivePreviewConfig {
  path: string
  /** Resolve a wiki target to a vault path (null = broken link). */
  resolveWiki: (target: string) => string | null
  /** Follow a resolved wiki link (mod+click). */
  openNote: (path: string) => void
}

const WIKILINK = /\[\[([^\]]+)\]\]/g

class SimpleWidget extends WidgetType {
  constructor(
    readonly kind: 'bullet' | 'hr' | 'frontmatter',
    readonly label = '',
  ) {
    super()
  }

  override eq(other: SimpleWidget): boolean {
    return other.kind === this.kind && other.label === this.label
  }

  toDOM(view: EditorView): HTMLElement {
    if (this.kind === 'bullet') {
      const s = document.createElement('span')
      s.className = 'cm-bullet'
      s.textContent = '•'
      return s
    }
    if (this.kind === 'hr') {
      const d = document.createElement('span')
      d.className = 'cm-hr'
      return d
    }
    const chip = document.createElement('button')
    chip.className = 'cm-frontmatter-chip'
    chip.textContent = `⋯ ${this.label || 'frontmatter'}`
    chip.title = 'edit frontmatter'
    chip.onclick = () => {
      const pos = view.posAtDOM(chip)
      view.dispatch({ selection: { anchor: pos } })
      view.focus()
    }
    return chip
  }

  override ignoreEvent(): boolean {
    return this.kind === 'frontmatter'
  }
}

export function livePreview(config: LivePreviewConfig) {
  // CodeMirror requires block decorations (our dataview/table/frontmatter
  // widgets, which change vertical layout) to come from a StateField; the
  // viewport-scoped inline work lives in a ViewPlugin.
  const blockField = StateField.define<DecorationSet>({
    create: (state) => buildBlocks(state, config),
    update: (deco, tr) =>
      tr.docChanged || tr.selection ? buildBlocks(tr.state, config) : deco,
    provide: (f) => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of((view) => view.state.field(f)),
    ],
  })

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      atomics: DecorationSet

      constructor(view: EditorView) {
        ;[this.decorations, this.atomics] = build(view, config)
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          ;[this.decorations, this.atomics] = build(u.view, config)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(p)?.atomics ?? RangeSet.empty,
        ),
    },
  )
  return [
    blockField,
    plugin,
    clickHandler(config),
    theme,
    syntaxHighlighting(codeHighlight),
  ]
}

/** Token colors for fenced code (the nested language parsers' tags). The
 *  markdown constructs themselves stay with the reveal decorations — only
 *  code-shaped tags are listed here, so the two systems never fight. */
const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: '#b294f0' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#9ece6a' },
  { tag: [t.comment, t.blockComment, t.lineComment], color: '#6a6a78', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.atom, t.null], color: '#e0af68' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#7aa2f7' },
  { tag: [t.typeName, t.className, t.namespace], color: '#73daca' },
  { tag: [t.propertyName, t.attributeName], color: '#7dcfff' },
  { tag: [t.definition(t.variableName), t.macroName], color: '#dcdce4' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#8e8e9a' },
  { tag: [t.tagName, t.angleBracket], color: '#f7768e' },
  { tag: t.invalid, color: '#e87e7e' },
])

/** Block widgets over the whole document: dataview fences, tables and the
 *  frontmatter chip, each rendered while the selection is elsewhere. */
function buildBlocks(
  state: EditorState,
  config: LivePreviewConfig,
): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  const touches = (from: number, to: number): boolean =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from)
  const touchesLines = (from: number, to: number): boolean =>
    touches(doc.lineAt(from).from, doc.lineAt(Math.min(to, doc.length)).to)

  const fm = frontmatterRange(doc.toString())
  let fmTo = -1
  if (fm) {
    const fmEnd = doc.line(fm.end).to
    fmTo = fmEnd
    if (!touchesLines(0, fmEnd)) {
      out.push(
        Decoration.replace({
          widget: new SimpleWidget(
            'frontmatter',
            frontmatterSummary(doc.toString(), fm),
          ),
          block: true,
        }).range(0, fmEnd),
      )
    }
  }

  const fences: Array<{ from: number; to: number }> = []
  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef): boolean | undefined {
      if (node.to <= fmTo) return false
      if (node.name === 'FencedCode') {
        fences.push({ from: node.from, to: node.to })
        const info = node.node.getChild('CodeInfo')
        const lang = info ? doc.sliceString(info.from, info.to) : ''
        if (lang === 'datalog-query' && !touchesLines(node.from, node.to)) {
          const text = node.node.getChild('CodeText')
          const source = text ? doc.sliceString(text.from, text.to) : ''
          out.push(
            Decoration.replace({
              widget: new DataViewWidget(config.path, source),
              block: true,
            }).range(node.from, node.to),
          )
        }
        return false
      }
      if (node.name === 'Table') {
        if (!touchesLines(node.from, node.to)) {
          out.push(
            Decoration.replace({
              widget: new TableWidget(doc.sliceString(node.from, node.to)),
              block: true,
            }).range(node.from, node.to),
          )
        }
        return false
      }
      return undefined
    },
  })

  // JSX component blocks (MDX): rendered while the caret is elsewhere,
  // raw JSX text when it's inside. Fenced code is excluded from the scan
  // so a ```jsx example never evaluates.
  for (const span of scanJsxBlocks(doc.toString(), fences)) {
    if (span.from < fmTo) continue
    if (touchesLines(span.from, span.to)) continue
    out.push(
      Decoration.replace({
        widget: new JsxWidget(span.source),
        block: true,
      }).range(span.from, span.to),
    )
  }

  return Decoration.set(
    out.sort((a, b) => a.from - b.from),
    true,
  )
}

function build(
  view: EditorView,
  config: LivePreviewConfig,
): [DecorationSet, DecorationSet] {
  const all: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []
  const { state } = view
  const doc = state.doc

  const touches = (from: number, to: number): boolean =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from)
  const touchesLines = (from: number, to: number): boolean =>
    touches(doc.lineAt(from).from, doc.lineAt(Math.min(to, doc.length)).to)

  const hide = (from: number, to: number) => {
    if (from >= to) return
    const deco = Decoration.replace({})
    all.push(deco.range(from, to))
    atomic.push(deco.range(from, to))
  }
  const widget = (
    from: number,
    to: number,
    w: WidgetType,
    block = false,
  ) => {
    const deco = Decoration.replace({ widget: w, block })
    all.push(deco.range(from, to))
    atomic.push(deco.range(from, to))
  }
  const mark = (from: number, to: number, cls: string) => {
    if (from < to) all.push(Decoration.mark({ class: cls }).range(from, to))
  }
  const lines = (from: number, to: number, cls: string) => {
    for (let p = doc.lineAt(from).from; p <= to; ) {
      const line = doc.lineAt(p)
      all.push(Decoration.line({ class: cls }).range(line.from))
      if (line.to + 1 > to) break
      p = line.to + 1
    }
  }

  // Frontmatter: the chip widget lives in the block StateField; here we only
  // style the revealed source (and skip the tree's confused view of those
  // lines — thematic breaks etc.).
  const fm = frontmatterRange(doc.toString())
  let fmTo = -1
  if (fm) {
    const fmEnd = doc.line(fm.end).to
    fmTo = fmEnd
    if (touchesLines(0, fmEnd)) lines(0, fmEnd, 'cm-frontmatter-src')
  }

  // Revealed JSX blocks (widgets live in the block field) read as source.
  {
    const fences: Array<{ from: number; to: number }> = []
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === 'FencedCode') {
          fences.push({ from: node.from, to: node.to })
          return false
        }
        return undefined
      },
    })
    for (const span of scanJsxBlocks(doc.toString(), fences)) {
      if (span.from >= fmTo && touchesLines(span.from, span.to)) {
        lines(span.from, span.to, 'cm-codeblock')
      }
    }
  }

  for (const range of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node: SyntaxNodeRef): boolean | undefined {
        if (node.to <= fmTo) return false

        const name = node.name
        if (name.startsWith('ATXHeading')) {
          const level = Number(name.slice('ATXHeading'.length)) || 1
          all.push(
            Decoration.line({ class: `cm-h cm-h${level}` }).range(
              doc.lineAt(node.from).from,
            ),
          )
          if (!touchesLines(node.from, node.to)) {
            for (const m of node.node.getChildren('HeaderMark')) {
              const extra = doc.sliceString(m.to, m.to + 1) === ' ' ? 1 : 0
              hide(m.from, m.to + extra)
            }
          }
          return undefined
        }

        switch (name) {
          case 'Emphasis':
          case 'StrongEmphasis':
          case 'Strikethrough': {
            const cls =
              name === 'Emphasis'
                ? 'cm-em'
                : name === 'StrongEmphasis'
                  ? 'cm-strong'
                  : 'cm-strike'
            mark(node.from, node.to, cls)
            if (!touches(node.from, node.to)) {
              const markName =
                name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
              for (const m of node.node.getChildren(markName)) hide(m.from, m.to)
            }
            return undefined
          }

          case 'InlineCode': {
            mark(node.from, node.to, 'cm-inline-code')
            if (!touches(node.from, node.to)) {
              for (const m of node.node.getChildren('CodeMark')) hide(m.from, m.to)
            }
            return undefined
          }

          case 'Link': {
            const marks = node.node.getChildren('LinkMark')
            if (marks.length >= 2) {
              mark(marks[0]!.to, marks[1]!.from, 'cm-link')
              if (!touches(node.from, node.to)) {
                hide(marks[0]!.from, marks[0]!.to)
                hide(marks[1]!.from, node.to)
              }
            }
            return false
          }

          case 'FencedCode': {
            // The datalog-query widget lives in the block StateField; when
            // revealed (or any other language) the fence is styled source.
            const info = node.node.getChild('CodeInfo')
            const lang = info ? doc.sliceString(info.from, info.to) : ''
            if (lang === 'datalog-query' && !touchesLines(node.from, node.to)) {
              return false
            }
            lines(node.from, node.to, 'cm-codeblock')
            return false
          }

          case 'Table': {
            // Widget in the block StateField; styled source when revealed.
            if (touchesLines(node.from, node.to)) {
              lines(node.from, node.to, 'cm-table-src')
            }
            return false
          }

          case 'TaskMarker': {
            if (!touchesLines(node.from, node.to)) {
              const checked =
                doc.sliceString(node.from, node.to).toLowerCase() === '[x]'
              widget(node.from, node.to, new CheckboxWidget(checked))
            }
            return undefined
          }

          case 'ListMark': {
            const markText = doc.sliceString(node.from, node.to)
            if (/^[-*+]$/.test(markText) && !touchesLines(node.from, node.to)) {
              widget(node.from, node.to, new SimpleWidget('bullet'))
            } else {
              mark(node.from, node.to, 'cm-list-mark')
            }
            return undefined
          }

          case 'Blockquote': {
            lines(node.from, node.to, 'cm-blockquote')
            if (!touchesLines(node.from, node.to)) {
              for (const m of node.node.getChildren('QuoteMark')) {
                const extra = doc.sliceString(m.to, m.to + 1) === ' ' ? 1 : 0
                hide(m.from, m.to + extra)
              }
            }
            return undefined
          }

          case 'HorizontalRule': {
            if (!touchesLines(node.from, node.to)) {
              widget(node.from, node.to, new SimpleWidget('hr'))
            }
            return undefined
          }

          default:
            return undefined
        }
      },
    })

    // Wiki links aren't in the markdown grammar — regex over visible text.
    const text = doc.sliceString(range.from, range.to)
    for (const m of text.matchAll(WIKILINK)) {
      const from = range.from + m.index
      const to = from + m[0].length
      if (from < fmTo) continue
      const target = (m[1] ?? '').split('|')[0]!.split('#')[0]!.trim()
      const resolved = config.resolveWiki(target)
      mark(from, to, resolved ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-broken')
      if (!touches(from, to)) {
        hide(from, from + 2)
        hide(to - 2, to)
      }
    }
  }

  const sortRanges = (rs: Range<Decoration>[]) =>
    Decoration.set(
      rs.sort(
        (a, b) => a.from - b.from || a.value.startSide - b.value.startSide,
      ),
      true,
    )
  return [sortRanges(all), sortRanges(atomic)]
}

/** Mod+click follows wiki links and markdown link URLs. */
function clickHandler(config: LivePreviewConfig) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.metaKey || e.ctrlKey)) return false
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
      if (pos === null) return false

      // Wiki link under the pointer?
      const line = view.state.doc.lineAt(pos)
      for (const m of line.text.matchAll(WIKILINK)) {
        const from = line.from + m.index
        if (pos >= from && pos <= from + m[0].length) {
          const target = (m[1] ?? '').split('|')[0]!.split('#')[0]!.trim()
          const resolved = config.resolveWiki(target)
          if (resolved) config.openNote(resolved)
          return true
        }
      }

      // Markdown link: find the enclosing Link node's URL.
      let url: string | null = null
      syntaxTree(view.state).iterate({
        from: pos,
        to: pos,
        enter(node) {
          if (node.name === 'URL') {
            url = view.state.doc.sliceString(node.from, node.to)
          }
          return undefined
        },
      })
      if (url) {
        window.open(url, '_blank', 'noreferrer')
        return true
      }
      return false
    },
  })
}

const theme = EditorView.theme({
  '&': { fontSize: '15px' },
  '.cm-content': {
    fontFamily:
      "-apple-system, 'Segoe UI', Roboto, sans-serif",
    lineHeight: '1.6',
    caretColor: 'var(--accent)',
    padding: '0 0 4rem',
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    background: 'color-mix(in srgb, var(--accent-dim) 40%, transparent)',
  },

  '.cm-h': { fontWeight: '700', lineHeight: '1.3' },
  '.cm-h1': { fontSize: '1.7em' },
  '.cm-h2': { fontSize: '1.45em' },
  '.cm-h3': { fontSize: '1.2em' },
  '.cm-h4, .cm-h5, .cm-h6': { fontSize: '1.05em' },

  '.cm-em': { fontStyle: 'italic' },
  '.cm-strong': { fontWeight: '700' },
  '.cm-strike': { textDecoration: 'line-through', opacity: '0.7' },
  '.cm-inline-code': {
    fontFamily: 'var(--mono)',
    fontSize: '0.88em',
    background: 'var(--bg-raise)',
    borderRadius: '4px',
    padding: '0.05em 0.3em',
  },

  '.cm-link': { color: 'var(--accent)', textDecoration: 'underline' },
  '.cm-wikilink': {
    color: 'var(--accent)',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dashed',
    cursor: 'pointer',
  },
  '.cm-wikilink-broken': { color: 'var(--danger)' },

  '.cm-codeblock': {
    fontFamily: 'var(--mono)',
    fontSize: '0.88em',
    background: 'var(--bg-raise)',
  },
  '.cm-table-src, .cm-frontmatter-src': {
    fontFamily: 'var(--mono)',
    fontSize: '0.88em',
  },

  '.cm-blockquote': {
    borderLeft: '3px solid var(--accent-dim)',
    paddingLeft: '1rem',
    color: 'var(--fg-dim)',
  },

  '.cm-bullet': { color: 'var(--accent)' },
  '.cm-list-mark': { color: 'var(--fg-dim)' },

  '.cm-hr': {
    display: 'inline-block',
    width: '100%',
    borderTop: '1px solid var(--border)',
    verticalAlign: 'middle',
  },

  '.cm-task-box': {
    accentColor: 'var(--accent)',
    marginRight: '0.1rem',
  },

  '.cm-frontmatter-chip': {
    display: 'inline-block',
    background: 'var(--bg-side)',
    border: '1px dashed var(--border)',
    borderRadius: '6px',
    color: 'var(--fg-dim)',
    cursor: 'pointer',
    fontFamily: 'var(--mono)',
    fontSize: '0.75rem',
    padding: '0.2rem 0.6rem',
    marginBottom: '0.6rem',
  },

  '.cm-react-widget': { padding: '0.2rem 0' },
})
