import type { ReactNode } from 'react'
import styles from './Banner.module.css'

export interface BannerProps {
  children: ReactNode
  tone?: 'warn' | 'error' | 'info'
  /** Pins it to the top of the viewport, over whatever is there. */
  floating?: boolean
}

/** A strip of bad news: an unreachable server, a missing capability. */
export function Banner({ children, tone = 'warn', floating = false }: BannerProps) {
  return (
    <div
      className={[styles.banner, styles[tone], floating ? styles.floating : '']
        .filter(Boolean)
        .join(' ')}
      role="status"
    >
      {children}
    </div>
  )
}
