import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconButton } from './IconButton.js'
import { Tooltip } from './Tooltip.js'

const meta: Meta<typeof Tooltip> = {
  title: 'Tooltip',
  component: Tooltip,
  // Room on every side, so each placement is visible.
  decorators: [
    (Story) => (
      <div style={{ padding: '5rem', display: 'flex', gap: '3rem' }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof Tooltip>

export const Default: Story = {
  args: { label: 'Reload  ⌘R', children: <IconButton>⟳</IconButton> },
}

/** Pick the side with room — a control at the bottom of a sidebar wants
 *  `top`, or the window clips the label. */
export const Placements: Story = {
  render: () => (
    <>
      {(['top', 'bottom', 'left', 'right'] as const).map((placement) => (
        <Tooltip key={placement} label={`Opens ${placement}`} placement={placement}>
          <IconButton>{placement[0]?.toUpperCase()}</IconButton>
        </Tooltip>
      ))}
    </>
  ),
}

/** It wraps anything, not just buttons — the pinned tiles and space dots use
 *  it because they have no visible text at all. */
export const AroundArbitraryContent: Story = {
  render: () => (
    <Tooltip label="A pinned tab with no label of its own">
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 44,
          height: 44,
          borderRadius: 10,
          background: 'color-mix(in srgb, currentColor 14%, transparent)',
        }}
      >
        F
      </span>
    </Tooltip>
  ),
}
