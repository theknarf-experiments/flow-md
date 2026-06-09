import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter } from '../lib/storybook-router.js'
import { FileTree } from './FileTree.js'

const meta: Meta<typeof FileTree> = {
  title: 'Sidebar/FileTree',
  component: FileTree,
  decorators: [(Story) => withRouter(<Story />)],
}
export default meta
type Story = StoryObj<typeof FileTree>

export const Vault: Story = {
  args: {
    files: [
      'index.md',
      'docs/tasks.md',
      'docs/calendar.md',
      'docs/sub/deep.md',
      'data/budget.csv',
      'cal/work.ics',
      'board.mdx',
    ],
    dirs: ['docs', 'docs/sub', 'data', 'cal', 'empty-folder'],
  },
}

export const Empty: Story = {
  args: { files: [], dirs: [] },
}
