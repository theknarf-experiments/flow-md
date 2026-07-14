// JSX block detection for MDX notes in the live editor. Multi-line JSX
// (`<Kanban\n  query=...\n/>`) is NOT a CommonMark HTML block — the markdown
// parser sees it as paragraph text — so component spans need finding
// separately.
//
// Primary path: parse with the real MDX grammar (remark-mdx) and take the
// top-level mdxJsxFlowElement nodes' positions. That handles everything the
// grammar does — nested self-closing children, arrow-function expression
// children with `=>`, JSX in attributes — and fenced code is naturally
// excluded because it parses as a code node. When the note's MDX is
// mid-typing broken (remark-mdx throws), we fall back to a line heuristic:
// a line opening a capitalised tag, through the line that closes it.
// Lowercase tags are left alone (raw HTML stays text), as are unterminated
// opens (no terminator = no span, so a half-typed component never swallows
// the rest of the note).

import type { Root } from 'mdast'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

export interface JsxSpan {
  from: number
  to: number
  source: string
}

const mdxProcessor = unified().use(remarkParse).use(remarkMdx)

/** Grammar-accurate scan: top-level capitalised JSX elements with offsets. */
function scanWithMdx(text: string): JsxSpan[] {
  const tree = mdxProcessor.parse(text) as Root
  const spans: JsxSpan[] = []
  for (const node of tree.children) {
    if (node.type !== ('mdxJsxFlowElement' as string)) continue
    const el = node as unknown as {
      name: string | null
      position?: { start: { offset?: number }; end: { offset?: number } }
    }
    if (!el.name || !/^[A-Z]/.test(el.name)) continue
    const from = el.position?.start.offset
    const to = el.position?.end.offset
    if (from === undefined || to === undefined) continue
    spans.push({ from, to, source: text.slice(from, to) })
  }
  return spans
}

/** Find JSX component blocks: MDX grammar when it parses, line heuristic
 *  when it doesn't. Memoised on the text — the editor calls this from both
 *  its decoration passes on every update. */
export function findJsxSpans(
  text: string,
  skip: ReadonlyArray<{ from: number; to: number }> = [],
): JsxSpan[] {
  if (cache && cache.text === text) return cache.spans
  let spans: JsxSpan[]
  try {
    spans = scanWithMdx(text)
  } catch {
    spans = scanJsxBlocks(text, skip)
  }
  cache = { text, spans }
  return spans
}

let cache: { text: string; spans: JsxSpan[] } | null = null

const OPEN = /^<([A-Z][A-Za-z0-9]*)/

export function scanJsxBlocks(
  text: string,
  skip: ReadonlyArray<{ from: number; to: number }> = [],
): JsxSpan[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let acc = 0
  for (const l of lines) {
    starts.push(acc)
    acc += l.length + 1
  }
  const inSkip = (pos: number) => skip.some((s) => pos >= s.from && pos < s.to)

  const spans: JsxSpan[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(OPEN)
    if (!m || inSkip(starts[i]!)) continue
    const name = m[1]!
    const selfClose = /\/>\s*$/
    const close = new RegExp(`</${name}>\\s*$`)
    for (let j = i; j < lines.length; j++) {
      const line = lines[j]!
      if (selfClose.test(line) || (j > i && close.test(line))) {
        const from = starts[i]!
        const to = starts[j]! + line.replace(/\s+$/, '').length
        spans.push({ from, to, source: text.slice(from, to) })
        i = j // continue scanning after this block
        break
      }
      // A same-line paired close: <Tag>...</Tag>
      if (j === i && close.test(line)) {
        const from = starts[i]!
        const to = from + line.replace(/\s+$/, '').length
        spans.push({ from, to, source: text.slice(from, to) })
        break
      }
    }
  }
  return spans
}
