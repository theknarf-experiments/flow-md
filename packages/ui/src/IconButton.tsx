import type { ButtonHTMLAttributes } from 'react'
import styles from './IconButton.module.css'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Slightly larger hit area and type size, for primary chrome. */
  size?: 'sm' | 'md'
}

/** A square, icon-sized button. Inherits colour from the surface it sits on,
 *  so it works on the shell's gradient and on a solid toolbar alike. */
export function IconButton({ size = 'md', className, type, ...rest }: IconButtonProps) {
  return (
    <button
      // Chrome-in-a-form is not a thing here, but an explicit type avoids the
      // implicit submit behaviour if one of these ever lands inside a form.
      type={type ?? 'button'}
      className={[styles.button, size === 'sm' ? styles.sm : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}
