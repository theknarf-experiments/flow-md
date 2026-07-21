import type { ReactNode } from 'react'
import styles from './CommandBar.module.css'

export interface CommandBarProps {
  open: boolean
  value: string
  placeholder?: string
  /** Small line under the field explaining what Enter will do. */
  hint?: ReactNode
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onDismiss: () => void
}

/** Centered modal input, Arc-style: no persistent address bar, just this on
 *  demand. Escape is handled by the caller, since it's usually part of a
 *  wider keymap. */
export function CommandBar(props: CommandBarProps) {
  const { open, value, placeholder, hint, onChange, onSubmit, onDismiss } = props
  if (!open) return null
  return (
    <div className={styles.overlay} onClick={onDismiss} role="presentation">
      {/* Clicks inside the panel must not reach the dismissing backdrop. */}
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="presentation">
        <input
          className={styles.input}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- it's a command bar
          autoFocus
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(e.currentTarget.value)
          }}
        />
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
    </div>
  )
}
