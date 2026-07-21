import styles from './LogPanel.module.css'

export interface LogLine {
  text: string
  tone?: 'ok' | 'err'
}

export interface LogPanelProps {
  lines: LogLine[]
  /** Accessible name, since a page may host more than one. */
  label?: string
}

/** Fixed-corner scrolling log. Newest first — the caller prepends, so no
 *  scroll management is needed. */
export function LogPanel({ lines, label = 'log' }: LogPanelProps) {
  return (
    <aside className={styles.log} aria-label={label}>
      {lines.map((line, i) => (
        <p
          // Append-only and never reordered, so the index is stable enough.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={i}
          className={line.tone ? styles[line.tone] : undefined}
        >
          {line.text}
        </p>
      ))}
    </aside>
  )
}
