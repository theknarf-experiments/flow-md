import type { Meta, StoryObj } from '@storybook/react-vite'
import { Placeholder } from './Placeholder.js'

const meta: Meta<typeof Placeholder> = {
  title: 'Placeholder',
  component: Placeholder,
  decorators: [
    (Story) => (
      <div style={{ height: 320, background: 'hsl(250 30% 24%)', borderRadius: 12 }}>
        {Story()}
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof Placeholder>

/** Nothing to connect to. The command is the point — an empty state that
 *  doesn't say what to do is a blank screen with a label. */
export const Disconnected: Story = {
  args: {
    icon: '🔌',
    title: 'No vault',
    children:
      'The browser reads its spaces from a flow-md server. Start one over the folder you keep your notes in, and this window will fill itself in.',
    command: 'flow-md serve docs/',
  },
}

/** Reachable, but with nothing in it yet. */
export const Empty: Story = {
  args: {
    icon: '📓',
    title: 'No spaces yet',
    children: 'A space is a markdown file with `type: space` in its frontmatter.',
    action: { label: 'Create one', onClick: () => {} },
  },
}
