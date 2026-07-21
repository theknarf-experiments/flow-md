import type { ButtonHTMLAttributes } from 'react'
import styles from './IconButton.module.css'
import { Tooltip, type TooltipPlacement } from './Tooltip.js'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg'
  /** Styled hover label. Preferred over `title`, whose native tooltip takes
   *  about a second to appear and can't be themed. */
  tooltip?: string
  tooltipPlacement?: TooltipPlacement
}

/** A square, icon-sized button. Inherits colour from the surface it sits on,
 *  so it works on the shell's gradient and on a solid toolbar alike. */
export function IconButton(props: IconButtonProps) {
  const { size = 'md', tooltip, tooltipPlacement, className, type, ...rest } = props
  const button = (
    <button
      // Chrome-in-a-form is not a thing here, but an explicit type avoids the
      // implicit submit behaviour if one of these ever lands inside a form.
      type={type ?? 'button'}
      className={[styles.button, styles[size], className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
  if (!tooltip) return button
  return (
    <Tooltip label={tooltip} {...(tooltipPlacement ? { placement: tooltipPlacement } : {})}>
      {button}
    </Tooltip>
  )
}
