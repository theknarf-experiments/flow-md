import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconButton } from './IconButton.js'
import { ChevronLeftIcon, ChevronRightIcon, ReloadIcon, SidebarIcon } from './icons.js'

const ICONS = { SidebarIcon, ChevronLeftIcon, ChevronRightIcon, ReloadIcon }

const meta: Meta = { title: 'Icons' }
export default meta

type Story = StoryObj

/** The set, at the size the shell's toolbar uses. */
export const All: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1.5rem' }}>
      {Object.entries(ICONS).map(([name, Glyph]) => (
        <figure key={name} style={{ margin: 0, textAlign: 'center' }}>
          <Glyph />
          <figcaption style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: '0.4rem' }}>
            {name.replace('Icon', '')}
          </figcaption>
        </figure>
      ))}
    </div>
  ),
}

/** They take their colour and weight from the button, so they dim with a
 *  disabled control and brighten on hover along with it. */
export const InButtons: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '0.35rem' }}>
      <IconButton size="lg" tooltip="Hide sidebar">
        <SidebarIcon />
      </IconButton>
      <IconButton size="lg" tooltip="Back" disabled>
        <ChevronLeftIcon />
      </IconButton>
      <IconButton size="lg" tooltip="Forward">
        <ChevronRightIcon />
      </IconButton>
      <IconButton size="lg" tooltip="Reload">
        <ReloadIcon />
      </IconButton>
    </div>
  ),
}

/** Scaling is a single prop — the stroke scales with the box, so an icon
 *  stays balanced instead of going spindly. */
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
      {[14, 18, 24, 36].map((size) => (
        <ReloadIcon key={size} size={size} />
      ))}
    </div>
  ),
}
