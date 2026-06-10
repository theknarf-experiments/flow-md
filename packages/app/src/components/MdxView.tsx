// MDX rendering: compile + evaluate the note's MDX in the browser and render
// it with the same remark pipeline and component overrides as plain markdown
// (so dataviews, task checkboxes and wiki links keep working), plus the
// flow-md component registry — <Kanban/>, <Graph/> — available unimported.
//
// Trust model: evaluating MDX runs the note's JSX as code. That's the same
// stance Obsidian takes with plugins and Templater scripts — your vault is
// your code. Compile errors render inline instead of crashing the page.

import { evaluate } from '@mdx-js/mdx'
import { type ComponentType, useEffect, useState } from 'react'
import * as runtime from 'react/jsx-runtime'
import type { QueryResult } from '../lib/api.js'
import { Graph } from './Graph.js'
import { Kanban } from './Kanban.js'
import { MD_COMPONENTS, MD_PLUGINS, MdProvider } from './MarkdownView.js'

/** Components MDX notes can use without importing. */
const REGISTRY = { Kanban, Graph }

type MdxComponent = ComponentType<{ components?: Record<string, unknown> }>

export function MdxView(props: {
  path: string
  content: string
  queries: QueryResult[]
  files: readonly string[]
}) {
  const { path, content, queries, files } = props
  const [compiled, setCompiled] = useState<{
    Content: MdxComponent | null
    error: string | null
  }>({ Content: null, error: null })

  useEffect(() => {
    let alive = true
    evaluate(content, {
      ...runtime,
      remarkPlugins: MD_PLUGINS as never,
    }).then(
      (mod) => {
        if (alive) {
          setCompiled({ Content: mod.default as MdxComponent, error: null })
        }
      },
      (err: unknown) => {
        if (alive) {
          setCompiled({
            Content: null,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    )
    return () => {
      alive = false
    }
  }, [content])

  return (
    <MdProvider path={path} content={content} queries={queries} files={files}>
      {compiled.error && (
        <p className="offline">mdx error: {compiled.error}</p>
      )}
      {compiled.Content && (
        <compiled.Content components={{ ...MD_COMPONENTS, ...REGISTRY }} />
      )}
    </MdProvider>
  )
}
