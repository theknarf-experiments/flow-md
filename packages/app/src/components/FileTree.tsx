import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { type TreeNode, buildTree } from '../lib/tree.js'

export function FileTree({ files }: { files: readonly string[] }) {
  return (
    <nav className="tree">
      <Level nodes={buildTree(files)} />
    </nav>
  )
}

function Level({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.path}>{n.children ? <Dir node={n} /> : <Leaf node={n} />}</li>
      ))}
    </ul>
  )
}

function Dir({ node }: { node: TreeNode }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" className="dir" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {node.name}
      </button>
      {open && <Level nodes={node.children ?? []} />}
    </>
  )
}

function Leaf({ node }: { node: TreeNode }) {
  return (
    <Link
      to="/note/$"
      params={{ _splat: node.path }}
      className="leaf"
      activeProps={{ className: 'leaf active' }}
    >
      {node.name}
    </Link>
  )
}
