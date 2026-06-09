import type { Meta, StoryObj } from '@storybook/react-vite'
import { DataView } from './DataView.js'

const RESULT = {
  id: 'Qstory0000001',
  path: 'docs/tasks.md',
  line: 12,
  source: 'Task(path, status, text, line)',
  columns: ['path', 'status', 'text', 'line'],
  writable: ['status', 'text'],
  rows: [
    ['docs/tasks.md', 'open', 'water the plants', 3],
    ['docs/tasks.md', 'closed', 'ship the release', 4],
    ['notes/a.md', 'open', 'write more stories', 9],
  ] as Array<Array<string | number>>,
}

const meta: Meta<typeof DataView> = {
  title: 'Views/DataView',
  component: DataView,
}
export default meta
type Story = StoryObj<typeof DataView>

export const WithRows: Story = {
  args: { source: RESULT.source, result: RESULT },
}

export const EmptyResult: Story = {
  args: {
    source: RESULT.source,
    result: { ...RESULT, rows: [] },
  },
}

export const NoServerMatch: Story = {
  args: { source: 'Task(path, "open", text, _)', result: null },
}
