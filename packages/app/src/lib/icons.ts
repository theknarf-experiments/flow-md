// File-type icons for the sidebar. Plain emoji: zero deps, readable at 15px.

const BY_EXT: Record<string, string> = {
  md: '📝',
  mdx: '🧩',
  ics: '🗓️',
  csv: '📊',
}

export function fileIcon(path: string): string {
  const ext = path.split('.').at(-1)?.toLowerCase() ?? ''
  return BY_EXT[ext] ?? '📄'
}
