import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState } from 'react'
import { SpaceRail } from './SpaceRail.js'
import { SwipeDeck } from './SwipeDeck.js'

const meta: Meta<typeof SwipeDeck> = {
  title: 'SwipeDeck',
  component: SwipeDeck,
  decorators: [
    (Story) => <div style={{ width: 240, height: 220, display: 'flex', color: 'white' }}>{Story()}</div>,
  ],
}
export default meta

type Story = StoryObj<typeof SwipeDeck>

const NAMES = ['Vault', 'Web', 'Scratch']

const HUES = [220, 310, 30]

const PANELS = NAMES.map((name, i) => (
  <div key={name} style={{ flex: 1, padding: '1rem', background: `hsl(${HUES[i]} 45% 30%)` }}>
    <h3 style={{ margin: '0 0 0.5rem' }}>{name}</h3>
    {['One', 'Two', 'Three'].map((row) => (
      <div key={row} style={{ padding: '0.3rem 0', opacity: 0.8 }}>
        {name} · {row}
      </div>
    ))}
  </div>
))

/** Two-finger swipe over the panels. The deck follows your fingers for as
 *  long as you hold them — nothing commits until you let go, and then it
 *  settles on whichever panel is closer. */
export const Default: Story = {
  args: { index: 1, children: PANELS },
}

/** Driven from outside as well as by the gesture: clicking the rail scrolls
 *  the deck, and swiping updates the rail.
 *
 *  `onProgress` fires every frame the deck moves, so the surround can follow
 *  the gesture instead of waiting for it — here the background fades between
 *  each panel's hue as you swipe, and fades back if you don't commit. It's
 *  written straight to the DOM rather than held in state, since it changes
 *  per frame and nothing renders from it. */
export const WithRail: Story = {
  render: () => {
    const [index, setIndex] = useState(0)
    const box = useRef<HTMLDivElement>(null)
    const tint = (position: number) => {
      const from = HUES[Math.min(Math.floor(position), HUES.length - 1)] ?? 0
      const to = HUES[Math.min(Math.floor(position) + 1, HUES.length - 1)] ?? from
      const hue = from + (to - from) * (position - Math.floor(position))
      box.current?.style.setProperty('background', `hsl(${hue} 45% 30%)`)
    }
    return (
      <div
        ref={box}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <SwipeDeck index={index} onIndexChange={setIndex} onProgress={tint}>
          {/* Unpainted, so what fades is the surround behind them. */}
          {NAMES.map((name) => (
            <div key={name} style={{ flex: 1, padding: '1rem' }}>
              <h3 style={{ margin: 0 }}>{name}</h3>
            </div>
          ))}
        </SwipeDeck>
        <SpaceRail
          spaces={NAMES.map((name) => ({ id: name, name }))}
          activeId={NAMES[index] ?? NAMES[0]!}
          onSelect={(id) => setIndex(NAMES.indexOf(String(id)))}
        />
      </div>
    )
  },
}
