import type { Meta, StoryObj } from '@storybook/react-vite'
import { Kanban } from './Kanban.js'

// Kanban polls the flow-md server (/run); without one it renders its error
// state, which is itself worth a story. With `flow-md serve docs/` running
// on :4747 the board comes alive in Storybook too.
const meta: Meta<typeof Kanban> = {
  title: 'Views/Kanban',
  component: Kanban,
}
export default meta
type Story = StoryObj<typeof Kanban>

export const TaskBoard: Story = {
  args: {
    query: 'Task(path, status, text, line)',
    groupBy: 'status',
    title: 'text',
    lanes: 'open,closed',
  },
}
