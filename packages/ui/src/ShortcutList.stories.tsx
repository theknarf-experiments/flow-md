import type { Meta, StoryObj } from '@storybook/react-vite'
import { Kbd } from './Kbd.js'
import { ShortcutList } from './ShortcutList.js'

const meta: Meta<typeof ShortcutList> = { title: 'ShortcutList', component: ShortcutList }
export default meta

type Story = StoryObj<typeof ShortcutList>

/** Grouped by category, with sequences reading as "G then G" so they aren't
 *  mistaken for a chord. */
export const Default: Story = {
  args: {
    shortcuts: [
      { name: 'New tab', keys: ['⌘', 'T'], category: 'Tabs & spaces' },
      { name: 'Close tab', keys: ['⌘', 'W'], category: 'Tabs & spaces' },
      { name: 'Next tab', keys: ['⌃', 'J'], category: 'Tabs & spaces' },
      { name: 'Scroll down', keys: ['J'], category: 'Page' },
      { name: 'Jump to the end', keys: ['⇧', 'G'], category: 'Page' },
      { name: 'Jump to the top', keys: ['G', 'G'], sequence: true, category: 'Page' },
    ],
  },
}

/** Ungrouped rows come first, above any categories. */
export const Ungrouped: Story = {
  args: {
    shortcuts: [
      { name: 'Command palette', keys: ['⌘', 'K'] },
      { name: 'Settings', keys: ['⌘', ','] },
    ],
  },
}

export const Keys = {
  name: 'Kbd on its own',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <Kbd keys={['⌘', '⇧', 'P']} />
      <Kbd keys={['Esc']} />
      <Kbd keys={['G', 'G']} sequence />
    </div>
  ),
}
