import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { AddressPill } from './AddressPill.js'
import { IconButton } from './IconButton.js'
import { SectionLabel, Sidebar, SidebarButton, Spacer, Toolbar } from './Sidebar.js'
import { SpaceRail } from './SpaceRail.js'
import { Tab } from './Tab.js'

const meta: Meta<typeof Sidebar> = {
  title: 'Sidebar',
  component: Sidebar,
  parameters: { layout: 'fullscreen' },
  // The sidebar inherits its colour, so give the canvas a surface to sit on.
  decorators: [
    (Story) => (
      <div
        style={{
          display: 'flex',
          height: '520px',
          background: 'linear-gradient(160deg, hsl(250 62% 32%), hsl(310 48% 14%))',
          color: 'rgba(255,255,255,0.92)',
        }}
      >
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof Sidebar>

const SPACES = [
  { id: 'vault', name: 'Vault' },
  { id: 'web', name: 'Web' },
  { id: 'scratch', name: 'Scratch' },
]

/** Everything composed the way the shell assembles it. */
export const Composed: Story = {
  render: () => {
    const [space, setSpace] = useState('vault')
    const [active, setActive] = useState('a')
    return (
      <Sidebar>
        <Toolbar>
          <IconButton title="toggle sidebar">▏</IconButton>
          <IconButton title="back" disabled>
            ‹
          </IconButton>
          <IconButton title="forward">›</IconButton>
          <IconButton title="reload">⟳</IconButton>
          <Spacer />
          <IconButton title="capture">⤓</IconButton>
        </Toolbar>
        <AddressPill value="localhost:4748/note/board.mdx" title="edit address" />
        <SectionLabel>Pinned</SectionLabel>
        <Tab label="flow-md" active={active === 'a'} pinned onSelect={() => setActive('a')} />
        <SectionLabel>Vault</SectionLabel>
        <Tab label="Example Domain" active={active === 'b'} onSelect={() => setActive('b')} />
        <Tab label="Chrome for Developers" active={active === 'c'} onSelect={() => setActive('c')} />
        <SidebarButton>+ New tab</SidebarButton>
        <Spacer />
        <SpaceRail spaces={SPACES} activeId={space} onSelect={setSpace} />
      </Sidebar>
    )
  },
}

/** Collapsing animates to zero width without unmounting, so contents keep
 *  their state. */
export const Collapsible: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Sidebar open={open}>
          <SectionLabel>Tabs</SectionLabel>
          <Tab label="flow-md" active />
          <Tab label="Example Domain" />
        </Sidebar>
        <div style={{ padding: '1rem' }}>
          <button type="button" onClick={() => setOpen((o) => !o)}>
            {open ? 'collapse' : 'expand'}
          </button>
        </div>
      </>
    )
  },
}

export const Narrow: Story = {
  render: () => (
    <Sidebar width={180}>
      <SectionLabel>Narrow</SectionLabel>
      <Tab label="a-very-long-tab-title-here.md" active />
    </Sidebar>
  ),
}
