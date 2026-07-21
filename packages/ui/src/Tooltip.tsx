import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps {
  label: ReactNode
  children: ReactNode
  /** Which side to open on. Pick the one with room: a control at the bottom
   *  of a sidebar wants `top`, or the label is clipped by the window. */
  placement?: TooltipPlacement
}

/** A styled hover label, preferred over the native `title` attribute — that
 *  takes about a second to appear, can't be themed, and is suppressed in some
 *  contexts.
 *
 *  CSS-only: it opens on hover of the wrapper and on keyboard focus within,
 *  so there's no timer state to leak and nothing to clean up. Deliberately
 *  keyboard focus rather than focus of any kind — a button stays focused
 *  after a click, which used to leave its tooltip stuck open. It is not a
 *  substitute for an accessible name — controls that are icon-only still need
 *  `aria-label`, since a tooltip is not announced. */
export function Tooltip({ label, children, placement = 'bottom' }: TooltipProps) {
  return (
    <span className={styles.wrap}>
      {children}
      <span className={`${styles.tip} ${styles[placement]}`} role="tooltip">
        {label}
      </span>
    </span>
  )
}
