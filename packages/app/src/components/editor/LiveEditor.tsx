// The live markdown editor: a CodeMirror 6 view whose document IS the note's
// source, with live-preview decorations on top (see live-preview.ts). One
// editing surface — no modes, no block hopping; the caret flows through the
// whole document and syntax reveals around it.
//
// Persistence: doc changes save through the optimistic notes collection,
// debounced. External changes (another editor, a kanban move, a dataview
// cell edit) sync in whenever they don't collide with local typing: if the
// incoming content matches what we last saved or last loaded, or the editor
// isn't focused, the doc is replaced wholesale; otherwise local wins until
// the next save round-trips.

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
  markdownLanguage,
} from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'
import { useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { frontmatterRange } from '../../lib/blocks.js'
import { notesCollection, saveNote } from '../../lib/db.js'
import { resolveWikiTarget } from '../../lib/wiki.js'
import { livePreview } from './live-preview.js'
import styles from './LiveEditor.module.css'

const SAVE_DEBOUNCE_MS = 500

/** Initial caret: just past the frontmatter, so the chip starts collapsed —
 *  a selection at position 0 would count as "caret inside the frontmatter"
 *  and reveal the raw YAML before the user ever clicks. */
function afterFrontmatter(content: string): number {
  const fm = frontmatterRange(content)
  if (!fm) return 0
  const lines = content.split('\n')
  const fmChars = lines.slice(0, fm.end).reduce((n, l) => n + l.length + 1, 0)
  return Math.min(fmChars, content.length)
}

export function LiveEditor(props: { path: string; content: string }) {
  const { path, content } = props
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const lastSynced = useRef(content)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  const { data: notes } = useLiveQuery((q) => q.from({ n: notesCollection }))
  const filesRef = useRef<string[]>([])
  filesRef.current = (notes ?? []).map((n) => n.path)

  // (Re)create the view per file.
  useEffect(() => {
    if (!host.current) return
    const save = (doc: string) => {
      if (doc === lastSynced.current) return
      lastSynced.current = doc
      void saveNote(path, doc)
    }
    const schedule = (v: EditorView) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save(v.state.doc.toString()), SAVE_DEBOUNCE_MS)
    }

    const state = EditorState.create({
      doc: lastSynced.current,
      selection: { anchor: afterFrontmatter(lastSynced.current) },
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        keymap.of([
          { key: 'Enter', run: insertNewlineContinueMarkup },
          { key: 'Backspace', run: deleteMarkupBackward },
          {
            key: 'Mod-s',
            run: (v) => {
              if (timer.current) clearTimeout(timer.current)
              save(v.state.doc.toString())
              return true
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        livePreview({
          path,
          resolveWiki: (target) => resolveWikiTarget(target, filesRef.current),
          openNote: (p) => void navigate({ to: '/note/$', params: { _splat: p } }),
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) schedule(u.view)
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    return () => {
      if (timer.current) clearTimeout(timer.current)
      // Flush pending edits when leaving the note.
      save(v.state.doc.toString())
      v.destroy()
      view.current = null
    }
    // lastSynced is seeded from `content` when `path` changes (below).
  }, [path, navigate])

  // Seed and sync external content.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const doc = v.state.doc.toString()
    if (content === doc) {
      lastSynced.current = content
      return
    }
    // Apply external changes unless the user is mid-edit with unsaved work.
    const dirty = doc !== lastSynced.current
    if (!dirty || !v.hasFocus) {
      lastSynced.current = content
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: content },
        // An unfocused editor gets a deterministic caret too — a full-doc
        // replace would otherwise map the selection to ~0, back inside the
        // frontmatter, popping the chip open.
        ...(v.hasFocus
          ? {}
          : { selection: { anchor: afterFrontmatter(content) } }),
      })
    }
  }, [content])

  return <div ref={host} className={styles.editor} data-testid="live-editor" />
}
