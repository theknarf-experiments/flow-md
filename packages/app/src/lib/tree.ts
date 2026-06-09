// Fold a flat list of vault-relative paths into a directory tree for the
// sidebar. Pure, so it's unit-testable without the DOM.

export interface TreeNode {
  name: string
  /** Vault-relative path ("dir/file.md" or "dir"). */
  path: string
  children?: TreeNode[]
}

export function buildTree(paths: readonly string[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const p of [...paths].sort()) {
    let level = root
    let prefix = ''
    const parts = p.split('/')
    parts.forEach((name, i) => {
      prefix = prefix ? `${prefix}/${name}` : name
      const isDir = i < parts.length - 1
      let node = level.find((n) => n.path === prefix)
      if (!node) {
        node = isDir ? { name, path: prefix, children: [] } : { name, path: prefix }
        level.push(node)
      }
      if (isDir) level = (node.children ??= [])
    })
  }
  sortLevel(root)
  return root
}

/** Directories first, then files, both alphabetical. */
function sortLevel(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const da = a.children ? 0 : 1
    const db = b.children ? 0 : 1
    return da !== db ? da - db : a.name.localeCompare(b.name)
  })
  for (const n of nodes) if (n.children) sortLevel(n.children)
}
