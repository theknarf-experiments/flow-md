import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Sheet, SheetSection } from './Sheet.js'
import { ShortcutList } from './ShortcutList.js'

const meta: Meta<typeof Sheet> = { title: 'Sheet', component: Sheet }
export default meta

type Story = StoryObj<typeof Sheet>

const SHORTCUTS = [
  { name: 'New tab', keys: ['⌘', 'T'], category: 'Tabs & spaces' },
  { name: 'Close tab', keys: ['⌘', 'W'], category: 'Tabs & spaces' },
  { name: 'Scroll down', keys: ['J'], category: 'Page' },
  { name: 'Jump to the top', keys: ['G', 'G'], sequence: true, category: 'Page' },
]

/** What the shell's ⌘, opens. */
export const Settings: Story = {
  args: {
    open: true,
    title: 'Settings',
    onClose: () => {},
    children: (
      <SheetSection title="Keyboard shortcuts">
        <ShortcutList shortcuts={SHORTCUTS} />
      </SheetSection>
    ),
  },
}

/** Several sections, and enough content to scroll — the wheel is confined to
 *  the panel, so nothing behind it moves. */
export const Scrolling: Story = {
  args: {
    open: true,
    title: 'Settings',
    onClose: () => {},
    children: (
      <>
        <SheetSection title="Keyboard shortcuts">
          <ShortcutList shortcuts={SHORTCUTS} />
        </SheetSection>
        {['Startup', 'Spaces', 'Data & privacy', 'About'].map((title) => (
          <SheetSection key={title} title={title}>
            <p style={{ margin: 0, fontSize: '0.83rem', opacity: 0.7 }}>Nothing here yet.</p>
          </SheetSection>
        ))}
      </>
    ),
  },
}

/** Escape and a click on the backdrop both close it. */
export const Toggling: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>
        <Sheet open={open} title="Settings" onClose={() => setOpen(false)}>
          <SheetSection title="Keyboard shortcuts">
            <ShortcutList shortcuts={SHORTCUTS} />
          </SheetSection>
        </Sheet>
      </>
    )
  },
}
