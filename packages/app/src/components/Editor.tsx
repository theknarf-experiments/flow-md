// Plain-textarea editor. The draft is component-local and the component is
// mounted with key={path}, so live collection syncs never clobber text mid-
// edit; saving goes through the notes collection (optimistic, so flipping
// back to view shows the new content instantly even before the PUT lands).

import { useState } from 'react'
import { saveNote } from '../lib/db.js'

export function Editor(props: { path: string; initial: string }) {
  const { path, initial } = props
  const [text, setText] = useState(initial)
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'error'>(
    'clean',
  )
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    setStatus('saving')
    saveNote(path, text).then(
      () => {
        setError(null)
        setStatus('clean')
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      },
    )
  }

  return (
    <div className="editor">
      <textarea
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          setStatus('dirty')
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault()
            save()
          }
        }}
      />
      <div className="editor-bar">
        <button type="button" disabled={status !== 'dirty'} onClick={save}>
          save
        </button>
        <span className={`status ${status}`}>
          {status === 'dirty' ? 'unsaved changes' : status}
        </span>
        {error && <span className="offline">{error}</span>}
      </div>
    </div>
  )
}
