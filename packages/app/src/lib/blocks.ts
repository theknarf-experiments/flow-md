// Frontmatter helpers for the live editor: every rendered note knows its
// 1-based source line ranges, and the `---` fenced YAML at the top collapses
// to a clickable chip. Pure, unit-testable.

export interface BlockRange {
  /** 1-based first source line of the block. */
  start: number
  /** 1-based last source line (inclusive). */
  end: number
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
