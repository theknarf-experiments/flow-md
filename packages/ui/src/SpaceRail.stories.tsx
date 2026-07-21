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
      { id: 'vault', name: 'Vault', title: 'Vault — separate container' },
      { id: 'web', name: 'Web' },
      { id: 'scratch', name: 'Scratch' },
    ],
    activeId: 'vault',
    onSelect: () => {},
  },
}

export const Interactive: Story = {
  render: () => {
    const [id, setId] = useState('web')
    return (
      <SpaceRail
        spaces={[
          { id: 'vault', name: 'Vault' },
          { id: 'web', name: 'Web' },
          { id: 'scratch', name: 'Scratch' },
        ]}
        activeId={id}
        onSelect={setId}
      />
    )
  },
}

/** Long names truncate rather than widening the sidebar. */
export const ManySpaces: Story = {
  args: {
    spaces: [
      { id: '1', name: 'Vault' },
      { id: '2', name: 'Web' },
      { id: '3', name: 'Scratch' },
      { id: '4', name: 'Research notes' },
    ],
    activeId: '3',
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
