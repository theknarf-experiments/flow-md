import { type RefObject, useEffect } from 'react'

export interface SwipeHandlers {
  onNext: () => void
  onPrev: () => void
}

export interface SwipeOptions {
  /** Accumulated horizontal distance before a swipe fires. */
  threshold?: number
  /** Quiet period after firing, so one long gesture switches once rather
   *  than repeatedly as it decelerates. */
  cooldownMs?: number
}

/** Two-finger horizontal swipe over an element — how Arc moves between
 *  spaces.
 *
 *  A trackpad swipe arrives as a stream of `wheel` events, so this
 *  accumulates `deltaX` and fires once past the threshold. Two details make
 *  it behave:
 *
 *  - It ignores any event where `|deltaY| >= |deltaX|`, so vertical scrolling
 *    inside the element is never hijacked.
 *  - It preventDefaults horizontal deltas, which otherwise trigger the
 *    browser's swipe-to-navigate. That needs a non-passive listener, hence
 *    addEventListener rather than an onWheel prop.
 */
export function useHorizontalSwipe(
  ref: RefObject<HTMLElement | null>,
  handlers: SwipeHandlers,
  options: SwipeOptions = {},
): void {
  const { threshold = 60, cooldownMs = 400 } = options
  const { onNext, onPrev } = handlers

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let accumulated = 0
    let firedAt = 0
    let resetTimer: ReturnType<typeof setTimeout> | undefined

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return
      e.preventDefault()

      const now = performance.now()
      if (now - firedAt < cooldownMs) return

      accumulated += e.deltaX
      clearTimeout(resetTimer)
      // A pause means the gesture ended; don't carry momentum into the next.
      resetTimer = setTimeout(() => {
        accumulated = 0
      }, 120)

      if (Math.abs(accumulated) >= threshold) {
        // Swiping left (negative deltaX) reveals what's to the left.
        if (accumulated > 0) onNext()
        else onPrev()
        accumulated = 0
        firedAt = now
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      clearTimeout(resetTimer)
      el.removeEventListener('wheel', onWheel)
    }
  }, [ref, onNext, onPrev, threshold, cooldownMs])
}
