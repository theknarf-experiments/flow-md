// @vitest-environment jsdom
//
// The gesture itself belongs to the browser now, so what's left to pin down
// is the seam: scroll position in, index out, and index back in again.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SwipeDeck } from '../src/SwipeDeck.js'

const WIDTH = 200

/** jsdom lays nothing out and never scrolls, so the viewport's geometry and
 *  scrollTo have to be stated. */
function mount(index: number, onIndexChange?: (i: number) => void) {
  const utils = render(
    <SwipeDeck index={index} onIndexChange={onIndexChange}>
      {['a', 'b', 'c'].map((p) => (
        <div key={p}>{p}</div>
      ))}
    </SwipeDeck>,
  )
  const viewport = utils.container.firstElementChild as HTMLElement
  Object.defineProperty(viewport, 'clientWidth', { value: WIDTH, configurable: true })
  const scrollTo = vi.fn()
  viewport.scrollTo = scrollTo as unknown as HTMLElement['scrollTo']
  const settleAt = (scrollLeft: number) => {
    viewport.scrollLeft = scrollLeft
    viewport.dispatchEvent(new Event('scrollend'))
  }
  return { ...utils, viewport, scrollTo, settleAt }
}

afterEach(cleanup)

describe('SwipeDeck', () => {
  it('reports the panel a gesture settled on', () => {
    const onIndexChange = vi.fn()
    const { settleAt } = mount(0, onIndexChange)
    settleAt(WIDTH * 2)
    expect(onIndexChange).toHaveBeenCalledWith(2)
  })

  it('takes the nearest panel when the scroll stops slightly off', () => {
    const onIndexChange = vi.fn()
    const { settleAt } = mount(0, onIndexChange)
    settleAt(WIDTH * 2 - 8)
    expect(onIndexChange).toHaveBeenCalledWith(2)
  })

  it('stays quiet when the deck settles back where it started', () => {
    const onIndexChange = vi.fn()
    const { settleAt } = mount(1, onIndexChange)
    settleAt(WIDTH)
    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it('scrolls to the panel when the index is changed from outside', () => {
    const { scrollTo, rerender } = mount(0)
    rerender(
      <SwipeDeck index={2}>
        {['a', 'b', 'c'].map((p) => (
          <div key={p}>{p}</div>
        ))}
      </SwipeDeck>,
    )
    expect(scrollTo).toHaveBeenCalledWith({ left: WIDTH * 2, behavior: 'smooth' })
  })

  it('does not scroll when it is already where it should be', () => {
    const { scrollTo, viewport, rerender } = mount(0)
    viewport.scrollLeft = WIDTH
    rerender(
      <SwipeDeck index={1}>
        {['a', 'b', 'c'].map((p) => (
          <div key={p}>{p}</div>
        ))}
      </SwipeDeck>,
    )
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('hides the panels that are off-screen from assistive tech', () => {
    const { container } = mount(1)
    const hidden = [...container.querySelectorAll('[aria-hidden="true"]')]
    expect(hidden).toHaveLength(2)
  })
})
