import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { HueSwatches } from './HueSwatches.js'

const meta: Meta<typeof HueSwatches> = { title: 'HueSwatches', component: HueSwatches }
export default meta

type Story = StoryObj<typeof HueSwatches>

const HUES = [250, 285, 320, 355, 25, 90, 155, 190]

/** Each swatch previews the gradient it produces rather than a flat colour,
 *  since that's what the window will actually look like. */
export const Default: Story = {
  render: () => {
    const [hue, setHue] = useState(250)
    return (
      <div
        style={{
          padding: '1rem',
          borderRadius: 12,
          background: `linear-gradient(150deg, hsl(${hue} 34% 34%), hsl(${hue + 40} 26% 20%))`,
        }}
      >
        <HueSwatches hues={HUES} value={hue} onSelect={setHue} />
      </div>
    )
  },
}
