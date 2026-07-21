import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tab } from './Tab.js'

const meta: Meta<typeof Tab> = {
  title: 'Tab',
  component: Tab,
  args: {
    label: 'flow-md',
    title: 'http://localhost:4748/',
    onSelect: () => {},
    onClose: () => {},
  },
  // The sidebar constrains width; without it the tab spans the canvas.
  decorators: [
    (Story) => (
      <div style={{ width: 232 }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof Tab>

export const Default: Story = {}

export const Active: Story = { args: { active: true } }

export const Pinned: Story = { args: { pinned: true, active: true, onTogglePin: () => {} } }

/** Long titles must truncate rather than widen the sidebar. */
export const Truncated: Story = {
  args: { label: 'A very long page title that will not fit in the sidebar at all' },
}

export const List: Story = {
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Tab {...args} label="flow-md" pinned active onTogglePin={() => {}} />
      <Tab {...args} label="Example Domain" onTogglePin={() => {}} />
      <Tab {...args} label="Chrome for Developers" onTogglePin={() => {}} />
    </div>
  ),
}
