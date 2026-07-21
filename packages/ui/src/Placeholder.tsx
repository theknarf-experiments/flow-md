import type { ReactNode } from 'react'
import styles from './Placeholder.module.css'

export interface PlaceholderProps {
  /** What's going on, in a few words. */
  title: string
  /** Why, and what to do about it. */
  children?: ReactNode
  /** A command to run, shown as one. */
  command?: string
  action?: { label: string; onClick: () => void }
  icon?: ReactNode
}

/** What fills a space that has nothing in it yet — or nothing it can reach.
 *
 *  An empty state earns its room by saying what to do next; "no data" on its
 *  own is just a blank screen with a label. */
export function Placeholder({ title, children, command, action, icon }: PlaceholderProps) {
  return (
    <div className={styles.placeholder}>
      {icon && (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.detail}>{children}</p>}
      {command && <code className={styles.command}>{command}</code>}
      {action && (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
