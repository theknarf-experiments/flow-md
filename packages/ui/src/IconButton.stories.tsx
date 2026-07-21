import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconButton } from './IconButton.js'

const meta: Meta<typeof IconButton> = {
  title: 'IconButton',
  component: IconButton,
  args: { children: '⟳', title: 'reload' },
}
export default meta

type Story = StoryObj<typeof IconButton>

export const Default: Story = {}

export const Small: Story = { args: { size: 'sm', children: '✕' } }

export const Disabled: Story = { args: { disabled: true, children: '‹' } }

/** How it actually appears — a row of chrome controls. */
export const Toolbar: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
      <IconButton title="toggle sidebar">▏</IconButton>
      <IconButton title="back" disabled>
        ‹
      </IconButton>
      <IconButton title="forward">›</IconButton>
      <IconButton title="reload">⟳</IconButton>
      <IconButton title="capture">⤓</IconButton>
    </div>
  ),
}
