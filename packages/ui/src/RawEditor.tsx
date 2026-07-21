// Plain-textarea editor with a save bar — the escape hatch for content no
// rich view can handle: half-typed MDX, a .ics file, a wholesale rewrite.
//
// The draft is component-local, so a live sync of the underlying document
// can't clobber text mid-edit; mount it with a key tied to the document to
// reset that draft when the document changes. Saving is the caller's — pass
// onSave and this tracks clean/dirty/saving/error around it.

import { useState } from 'react'
import styles from './RawEditor.module.css'

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'error'

export interface RawEditorProps {
  initial: string
  onSave: (text: string) => Promise<unknown>
  spellCheck?: boolean
  'data-testid'?: string
}

export function RawEditor(props: RawEditorProps) {
  const { initial, onSave, spellCheck = false, 'data-testid': testId = 'raw-editor' } = props
  const [text, setText] = useState(initial)
  const [status, setStatus] = useState<SaveStatus>('clean')
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    setStatus('saving')
    onSave(text).then(
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
    <div className={styles.editor} data-testid={testId}>
      <textarea
        value={text}
        spellCheck={spellCheck}
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
      <div className={styles.bar}>
        <button type="button" disabled={status !== 'dirty'} onClick={save}>
          save
        </button>
        <span className={`${styles.status} ${status === 'dirty' ? styles.dirty : ''}`}>
          {status === 'dirty' ? 'unsaved changes' : status}
        </span>
        {error && <span className={styles.error}>{error}</span>}
      </div>
    </div>
  )
}
