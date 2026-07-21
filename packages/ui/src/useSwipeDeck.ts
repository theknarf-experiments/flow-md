import { type RefObject, useEffect, useRef, useState } from 'react'

export interface SwipeDeckOptions {
  /** How many panels there are; the deck resists rather than wraps at the ends. */
  count: number
  index: number
  onIndex: (index: number) => void
  /** Panel width in px. Defaults to the listening element's own width, which
   *  is right whenever the deck fills it. */
  width?: number
  /** Silence that counts as "fingers lifted" — wheel has no end event. */
  endDelayMs?: number
}

export interface SwipeDeckState {
  /** Live horizontal displacement of the track, in px. */
  offset: number
  /** True while a gesture is in flight — the deck drops its transition so it
   *  tracks the fingers instead of lagging behind them. */
  dragging: boolean
}

/** Trackpad swipe that drags a deck of panels, the way Arc slides between
 *  spaces: the panels follow your fingers, and on release the deck settles to
 *  whichever neighbour is closer.
 *
 *  Three things make this behave:
 *
 *  - There is no "gesture ended" event for `wheel`, so a short silence stands
 *    in for lifting your fingers. macOS momentum keeps events coming after
 *    the lift, which reads as a fling and is welcome here.
 *  - It ignores any event where `|deltaY| >= |deltaX|`, so scrolling inside a
 *    panel is never hijacked.
 *  - It preventDefaults horizontal deltas, which otherwise trigger Chrome's
 *    swipe-to-navigate. That needs a non-passive listener, hence
 *    addEventListener rather than an onWheel prop.
 *
 *  Note that `app-region: drag` swallows wheel events before the page sees
 *  them, so a draggable surface can't also be swipeable. */
export function useSwipeDeck(
  ref: RefObject<HTMLElement | null>,
  options: SwipeDeckOptions,
): SwipeDeckState {
  const [state, setState] = useState<SwipeDeckState>({ offset: 0, dragging: false })

  // Read through a ref so a re-render mid-gesture doesn't tear down the
  // listener and lose the accumulated distance.
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let offset = 0
    let endTimer: ReturnType<typeof setTimeout> | undefined

    const settle = () => {
      const { count, index, onIndex } = latest.current
      const width = latest.current.width ?? el.clientWidth
      if (offset <= -width / 2 && index < count - 1) onIndex(index + 1)
      else if (offset >= width / 2 && index > 0) onIndex(index - 1)
      offset = 0
      setState({ offset: 0, dragging: false })
    }

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return
      e.preventDefault()

      const { count, index } = latest.current
      const width = latest.current.width ?? el.clientWidth
      // deltaX > 0 means scrolling right, which pulls the next panel in from
      // the right — so the track moves the other way.
      const applied = -e.deltaX
      // The deck doesn't wrap: past the first or last panel there is nothing
      // to reveal, so the drag goes stiff and springs back rather than
      // cycling round to the other end.
      const atEdge = (index === 0 && applied > 0) || (index === count - 1 && applied < 0)
      offset += atEdge ? applied * 0.25 : applied
      const limit = atEdge ? width * 0.15 : width
      offset = Math.max(-limit, Math.min(limit, offset))

      setState({ offset, dragging: true })
      clearTimeout(endTimer)
      endTimer = setTimeout(settle, latest.current.endDelayMs ?? 90)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      clearTimeout(endTimer)
      el.removeEventListener('wheel', onWheel)
    }
  }, [ref])

  return state
}
