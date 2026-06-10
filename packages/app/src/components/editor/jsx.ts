// JSX block detection for MDX notes in the live editor. Multi-line JSX
// (`<Kanban\n  query=...\n/>`) is NOT a CommonMark HTML block — the markdown
// parser sees it as paragraph text — so we scan for component spans
// ourselves: a line opening a capitalised tag, through the line that closes
// it (self-closing `/>` or a matching `</Name>`). Lowercase tags are left
// alone (raw HTML stays text), as are unterminated opens (no terminator =
// no span, so a half-typed component never swallows the rest of the note).

export interface JsxSpan {
  from: number
  to: number
  source: string
}

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
