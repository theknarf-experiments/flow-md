// Sidebar file tree: explicit folders (so empty ones show), file-type icons,
// and hover actions — rename/delete on files, new-subfolder/rename/delete on
// folders. Actions use window.prompt/confirm and go through the db layer's
// fs mutations, which refetch the collections on completion.

import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { deleteFile, deleteFolder, makeFolder, movePath } from '../lib/db.js'
import { fileIcon } from '../lib/icons.js'
import { type TreeNode, buildTree } from '../lib/tree.js'
import styles from './FileTree.module.css'

export function FileTree(props: {
  files: readonly string[]
  dirs?: readonly string[]
}) {
  return (
    <nav className={styles.tree}>
      <Level nodes={buildTree(props.files, props.dirs ?? [])} />
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

/** Rename keeps the file in place unless the new name has a slash, in which
 *  case it's treated as a vault-relative path. */
function renameTarget(oldPath: string, input: string): string {
  if (input.includes('/')) return input
  const dir = oldPath.split('/').slice(0, -1).join('/')
  return dir ? `${dir}/${input}` : input
}

function Dir({ node }: { node: TreeNode }) {
  const [open, setOpen] = useState(true)

  const addSubfolder = () => {
    const name = window.prompt(`New folder inside ${node.path}/:`)
    if (name) void makeFolder(`${node.path}/${name}`)
  }
  const rename = () => {
    const name = window.prompt(`Rename folder ${node.path} to:`, node.name)
    if (name && name !== node.name) {
      void movePath(node.path, renameTarget(node.path, name))
    }
  }
  const remove = () => {
    if (window.confirm(`Delete folder ${node.path} and everything in it?`)) {
      void deleteFolder(node.path)
    }
  }

  return (
    <>
      <span className={styles.row}>
        <button
          type="button"
          className={styles.dir}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'} {node.name}
        </button>
        <span className={styles.actions}>
          <button type="button" title="new subfolder" onClick={addSubfolder}>
            ＋
          </button>
          <button type="button" title="rename folder" onClick={rename}>
            ✎
          </button>
          <button type="button" title="delete folder" onClick={remove}>
            ✕
          </button>
        </span>
      </span>
      {open && <Level nodes={node.children ?? []} />}
    </>
  )
}

function Leaf({ node }: { node: TreeNode }) {
  const navigate = useNavigate()
  const location = useLocation()

  const rename = () => {
    const name = window.prompt(`Rename ${node.path} to:`, node.name)
    if (!name || name === node.name) return
    const to = renameTarget(node.path, name)
    void movePath(node.path, to).then(() => {
      // Follow the rename if the file is open right now.
      if (location.pathname === `/note/${node.path}`) {
        void navigate({ to: '/note/$', params: { _splat: to } })
      }
    })
  }
  const remove = () => {
    if (window.confirm(`Delete ${node.path}?`)) void deleteFile(node.path)
  }

  return (
    <span className={styles.row}>
      <Link
        to="/note/$"
        params={{ _splat: node.path }}
        className={styles.leaf}
        data-testid="tree-leaf"
        activeProps={{ className: `${styles.leaf} ${styles.active}` }}
      >
        <span className={styles.icon}>{fileIcon(node.path)}</span>
        {node.name}
      </Link>
      <span className={styles.actions}>
        <button type="button" title="rename" onClick={rename}>
          ✎
        </button>
        <button type="button" title="delete" onClick={remove}>
          ✕
        </button>
      </span>
    </span>
  )
}
