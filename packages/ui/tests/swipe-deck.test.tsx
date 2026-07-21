// @vitest-environment jsdom
//
// The deck's feel lives in arithmetic — how far is far enough, and what
// happens at the ends — so it's worth pinning down away from a real trackpad.

import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SwipeDeck } from '../src/SwipeDeck.js'
import { useSwipeDeck } from '../src/useSwipeDeck.js'

const WIDTH = 200

function Deck(props: { index: number; count: number; onIndex: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // jsdom lays nothing out, so clientWidth would be 0 — state the width.
  const swipe = useSwipeDeck(ref, { ...props, width: WIDTH })
  return (
    <div ref={ref} data-testid="surface">
      <SwipeDeck index={props.index} offset={swipe.offset} dragging={swipe.dragging}>
        {Array.from({ length: props.count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixture panels
          <div key={i}>panel {i}</div>
        ))}
      </SwipeDeck>
    </div>
  )
}

/** One flick: a burst of wheel events, then the silence that stands in for
 *  lifting your fingers. */
function swipe(el: Element, deltaX: number, steps = 4) {
  act(() => {
    for (let i = 0; i < steps; i++) {
      el.dispatchEvent(
        new WheelEvent('wheel', { deltaX: deltaX / steps, deltaY: 0, bubbles: true, cancelable: true }),
      )
    }
  })
}

function release() {
  act(() => {
    vi.advanceTimersByTime(200)
  })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useSwipeDeck', () => {
  it('advances when released past halfway', () => {
    const onIndex = vi.fn()
    const { getByTestId } = render(<Deck index={0} count={3} onIndex={onIndex} />)
    swipe(getByTestId('surface'), WIDTH * 0.6)
    release()
    expect(onIndex).toHaveBeenCalledWith(1)
  })

  it('springs back when released short of halfway', () => {
    const onIndex = vi.fn()
    const { getByTestId } = render(<Deck index={0} count={3} onIndex={onIndex} />)
    swipe(getByTestId('surface'), WIDTH * 0.3)
    release()
    expect(onIndex).not.toHaveBeenCalled()
  })

  it('goes back with the opposite direction', () => {
    const onIndex = vi.fn()
    const { getByTestId } = render(<Deck index={1} count={3} onIndex={onIndex} />)
    swipe(getByTestId('surface'), -WIDTH * 0.8)
    release()
    expect(onIndex).toHaveBeenCalledWith(0)
  })

  it('stops at the ends rather than wrapping', () => {
    const onIndex = vi.fn()
    const last = render(<Deck index={2} count={3} onIndex={onIndex} />)
    swipe(last.getByTestId('surface'), WIDTH * 3)
    release()
    expect(onIndex).not.toHaveBeenCalled()
    last.unmount()

    const first = render(<Deck index={0} count={3} onIndex={onIndex} />)
    swipe(first.getByTestId('surface'), -WIDTH * 3)
    release()
    expect(onIndex).not.toHaveBeenCalled()
  })

  it('ignores vertical scrolling, so panels stay scrollable', () => {
    const onIndex = vi.fn()
    const { getByTestId } = render(<Deck index={0} count={3} onIndex={onIndex} />)
    act(() => {
      for (let i = 0; i < 6; i++) {
        getByTestId('surface').dispatchEvent(
          new WheelEvent('wheel', { deltaX: 20, deltaY: 90, bubbles: true, cancelable: true }),
        )
      }
    })
    release()
    expect(onIndex).not.toHaveBeenCalled()
  })

  it('follows the gesture before it ends, then settles', () => {
    const onIndex = vi.fn()
    const { getByTestId, container } = render(<Deck index={0} count={3} onIndex={onIndex} />)
    swipe(getByTestId('surface'), 80)
    const track = container.querySelector('[style*="translateX"]') as HTMLElement
    // Mid-gesture the track has moved, and moved the way the fingers went.
    expect(track.style.transform).toContain('-80px')
    release()
    expect(track.style.transform).toContain('+ 0px')
  })
})
