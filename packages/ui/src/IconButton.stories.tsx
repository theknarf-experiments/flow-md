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

export const Large: Story = { args: { size: 'lg', children: '⟳' } }

/** Hover to see the styled label — the native `title` takes about a second
 *  and can't be themed. */
export const WithTooltip: Story = {
  args: { tooltip: 'Reload  ⌘R', children: '⟳' },
}

export const Disabled: Story = { args: { disabled: true, children: '‹' } }

/** How the shell actually uses them: four navigation controls, sized to be
 *  readable at rest rather than only on hover. */
export const Toolbar: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
      <IconButton tooltip="Hide sidebar  ⌘S">▏</IconButton>
      <IconButton tooltip="Back" disabled>
        ‹
      </IconButton>
      <IconButton tooltip="Forward">›</IconButton>
      <IconButton tooltip="Reload">⟳</IconButton>
    </div>
  ),
}
