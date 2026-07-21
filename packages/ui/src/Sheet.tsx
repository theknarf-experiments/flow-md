import { type ReactNode, useEffect, useRef } from 'react'
import styles from './Sheet.module.css'

export interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/** A dismissible panel over the window, for things too big for a menu and too
 *  incidental for a page. Closes on Escape and on a click outside it.
 *
 *  Scrolling is confined to the panel: the pointer usually rests over the
 *  backdrop, where a wheel would otherwise scroll whatever is behind. React's
 *  onWheel is passive, so preventDefault there does nothing — hence a
 *  non-passive listener that routes the delta into the body. */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const overlay = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = overlay.current
    if (!open || !el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (body.current) body.current.scrollTop += e.deltaY
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Before anything else reads it — an Escape aimed at the sheet isn't
      // meant for the palette or the page underneath.
      e.stopPropagation()
      onClose()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('keydown', onKey, true)
    return () => {
      el.removeEventListener('wheel', onWheel)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlay}
      className={styles.overlay}
      // A click that starts and ends on the backdrop, not one that began as a
      // drag inside the panel and happened to end out here.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className={styles.body} ref={body}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** A titled block within a sheet. */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}
