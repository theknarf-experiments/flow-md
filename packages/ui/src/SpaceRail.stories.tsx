import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { AddressPill } from './AddressPill.js'
import { SpaceRail } from './SpaceRail.js'

const meta: Meta<typeof SpaceRail> = {
  title: 'SpaceRail',
  component: SpaceRail,
  decorators: [
    (Story) => (
      <div style={{ width: 232 }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof SpaceRail>

export const Default: Story = {
  args: {
    spaces: [
      { id: 'vault', name: 'Vault', emoji: '📓', title: 'Vault — separate container' },
      { id: 'web', name: 'Web', emoji: '🌐' },
      { id: 'scratch', name: 'Scratch', emoji: '🧪' },
    ],
    activeId: 'vault',
    onSelect: () => {},
  },
}

/** With the trailing + Arc uses to create a space. */
export const WithAddButton: Story = {
  args: {
    spaces: [
      { id: 'vault', name: 'Vault', emoji: '📓' },
      { id: 'web', name: 'Web', emoji: '🌐' },
      { id: 'scratch', name: 'Scratch' },
    ],
    activeId: 'vault',
    onSelect: () => {},
    onAddSpace: () => {},
  },
}

export const Interactive: Story = {
  render: () => {
    const [id, setId] = useState('web')
    return (
      <SpaceRail
        spaces={[
          { id: 'vault', name: 'Vault', emoji: '📓' },
          { id: 'web', name: 'Web', emoji: '🌐' },
          { id: 'scratch', name: 'Scratch', emoji: '🧪' },
        ]}
        activeId={id}
        onSelect={setId}
      />
    )
  },
}

/** Emoji are optional — a space without one falls back to a plain dot. */
export const MixedEmoji: Story = {
  args: {
    spaces: [
      { id: '1', name: 'Vault', emoji: '📓' },
      { id: '2', name: 'Web' },
      { id: '3', name: 'Scratch', emoji: '🧪' },
      { id: '4', name: 'Research notes' },
    ],
    activeId: '2',
    onSelect: () => {},
  },
}

export const Address: Story = {
  name: 'AddressPill',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <AddressPill value="localhost:4748/note/board.mdx" />
      <AddressPill value="" />
      <AddressPill value="a-very-long-url-that-has-to-be-truncated.example.com/some/deep/path" />
    </div>
  ),
}
