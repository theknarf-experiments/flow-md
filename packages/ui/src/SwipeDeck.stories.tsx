import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState } from 'react'
import { SpaceRail } from './SpaceRail.js'
import { SwipeDeck } from './SwipeDeck.js'
import { useSwipeDeck } from './useSwipeDeck.js'

const meta: Meta<typeof SwipeDeck> = {
  title: 'SwipeDeck',
  component: SwipeDeck,
}
export default meta

type Story = StoryObj<typeof SwipeDeck>

const PANELS = ['Vault', 'Web', 'Scratch'].map((name, i) => (
  <div key={name} style={{ padding: '1rem', background: `hsl(${i * 90 + 220} 45% 30%)` }}>
    <h3 style={{ margin: '0 0 0.5rem' }}>{name}</h3>
    {['One', 'Two', 'Three'].map((row) => (
      <div key={row} style={{ padding: '0.3rem 0', opacity: 0.8 }}>
        {name} · {row}
      </div>
    ))}
  </div>
))

export const Default: Story = {
  args: { index: 1, children: PANELS },
  decorators: [(Story) => <div style={{ width: 240, color: 'white' }}>{Story()}</div>],
}

/** Mid-drag: the track follows the fingers, so the neighbouring panel is
 *  already showing before anything is committed. */
export const MidDrag: Story = {
  args: { index: 1, offset: 90, dragging: true, children: PANELS },
  decorators: [(Story) => <div style={{ width: 240, color: 'white' }}>{Story()}</div>],
}

/** The real thing — two-finger swipe over the box. Release past halfway and
 *  it advances; release short of it and it springs back. It stops at either
 *  end rather than wrapping. */
export const Swipeable: Story = {
  render: () => {
    const ref = useRef<HTMLDivElement>(null)
    const [index, setIndex] = useState(0)
    const swipe = useSwipeDeck(ref, { count: PANELS.length, index, onIndex: setIndex })
    return (
      <div ref={ref} style={{ width: 240, color: 'white' }}>
        <SwipeDeck index={index} offset={swipe.offset} dragging={swipe.dragging}>
          {PANELS}
        </SwipeDeck>
        <SpaceRail
          spaces={['Vault', 'Web', 'Scratch'].map((name) => ({ id: name, name }))}
          activeId={['Vault', 'Web', 'Scratch'][index] ?? 'Vault'}
          onSelect={(id) => setIndex(['Vault', 'Web', 'Scratch'].indexOf(String(id)))}
        />
      </div>
    )
  },
}
