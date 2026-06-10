// Helpers for block-level editing of a note's source: every rendered block
// knows its 1-based source line range (remark positions), so editing a block
// is "replace lines start..end with the draft". Pure, unit-testable.

export interface BlockRange {
  /** 1-based first source line of the block. */
  start: number
  /** 1-based last source line (inclusive). */
  end: number
}

/** Sentinel range for "append a new block at the end of the note". */
export const APPEND: BlockRange = { start: -1, end: -1 }

/** The source text of a block. */
export function sliceLines(content: string, range: BlockRange): string {
  if (range.start < 1) return ''
  return content
    .split('\n')
    .slice(range.start - 1, range.end)
    .join('\n')
}

/** Replace a block's lines with the draft (or append for the APPEND
 *  sentinel, separated by a blank line). Preserves everything else. */
export function replaceLines(
  content: string,
  range: BlockRange,
  draft: string,
): string {
  const lines = content.split('\n')
  if (range.start < 1) {
    // Append: ensure exactly one blank line between old content and draft,
    // and keep a trailing newline.
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
      lines.pop()
    }
    if (draft.trim() === '') return `${lines.join('\n')}\n`
    return `${[...lines, '', draft].join('\n')}\n`
  }
  const before = lines.slice(0, range.start - 1)
  const after = lines.slice(range.end)
  const middle = draft === '' ? [] : draft.split('\n')
  return [...before, ...middle, ...after].join('\n')
}

/** Join hard-wrapped source lines into one logical line for editing flow
 *  blocks (paragraphs, headings): a single newline inside a paragraph is a
 *  markdown soft break, so the rendered text reflows to the column width
 *  while the source shows its literal ~76-col wrapping — joining makes the
 *  editor wrap exactly like the rendered block. GFM hard breaks (a line
 *  ending in two spaces or a backslash) are real <br>s and survive. */
export function unwrapFlow(text: string): string {
  return text.replace(/([^\n])\n(?!\n)/g, (_, last: string, at: number) => {
    const line = text.slice(0, at + 1)
    if (line.endsWith('  ') || last === '\\') return `${last}\n`
    return `${last} `
  })
}

/** Insert `draft` as a standalone block after `afterLine` (0 = top of the
 *  file), padding with blank lines so it doesn't merge into neighbours.
 *  Returns the new content plus the inserted block's line range, so the
 *  caller can keep editing relative to it. */
export function insertBlock(
  content: string,
  afterLine: number,
  draft: string,
): { content: string; range: BlockRange } {
  const lines = content.split('\n')
  const before = lines.slice(0, afterLine)
  const after = lines.slice(afterLine)
  const mid = draft === '' ? [] : draft.split('\n')
  const padBefore = before.length > 0 && before[before.length - 1]!.trim() !== ''
  const padAfter = after.length > 0 && after[0]!.trim() !== ''
  const out = [
    ...before,
    ...(padBefore ? [''] : []),
    ...mid,
    ...(padAfter ? [''] : []),
    ...after,
  ]
  const start = before.length + (padBefore ? 1 : 0) + 1
  return {
    content: out.join('\n'),
    range: { start, end: start + Math.max(mid.length - 1, 0) },
  }
}

/** The frontmatter block (`---` fenced YAML at the very top), if present. */
export function frontmatterRange(content: string): BlockRange | null {
  const lines = content.split('\n')
  if (lines[0]?.trimEnd() !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === '---') return { start: 1, end: i + 1 }
  }
  return null
}

/** One-line summary of a frontmatter block for the collapsed chip. */
export function frontmatterSummary(content: string, range: BlockRange): string {
  const keys = content
    .split('\n')
    .slice(range.start, range.end - 1)
    .map((l) => l.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1])
    .filter((k): k is string => !!k)
  return keys.join(', ')
}
