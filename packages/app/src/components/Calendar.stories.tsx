import type { Cell, FlowMdHost, QueryState } from '@flow-md/view-api'
import { FlowMdHostProvider } from '@flow-md/view-api'
import { Calendar } from '@flow-md/view-ics'
import type { Meta, StoryObj } from '@storybook/react-vite'

// Calendar reads the ICS plugin's Event* facts through the host. The mock
// host answers each relation query with canned rows, so the agenda renders
// without a running server.
function state(columns: string[], rows: Cell[][]): QueryState {
  return { columns, rows, writable: [], error: null, ready: true, refresh: () => {} }
}

function mockHost(rows: Record<string, Cell[][]>): FlowMdHost {
  return {
    useQuery: (source: string) => {
      if (source.startsWith('EventTime'))
        return state(['path', 'uid', 'start', 'end'], rows.times ?? [])
      if (source.startsWith('EventLocation'))
        return state(['path', 'uid', 'location'], rows.locations ?? [])
      if (source.startsWith('EventStatus'))
        return state(['path', 'uid', 'status'], rows.statuses ?? [])
      if (source.startsWith('EventRecurrence'))
        return state(['path', 'uid', 'rrule'], rows.recurrences ?? [])
      return state(['path', 'uid', 'summary', 'line'], rows.base ?? [])
    },
    useFiles: () => [],
    updateCell: async () => {},
    deleteRow: async () => {},
    insertRow: async () => {},
    resolveWiki: () => null,
    openNote: () => {},
  }
}

const CAL = {
  base: [
    ['work.ics', 'kickoff', 'Project kickoff', 4],
    ['work.ics', 'standup', 'Weekly standup', 12],
    ['work.ics', 'offsite', 'Team offsite', 20], // no time → "all day"
  ] as Cell[][],
  times: [
    ['work.ics', 'kickoff', '2026-06-15T10:00:00.000Z', '2026-06-15T11:00:00.000Z'],
    ['work.ics', 'standup', '2026-06-16T09:00:00.000Z', '2026-06-16T09:30:00.000Z'],
  ] as Cell[][],
  locations: [['work.ics', 'kickoff', 'Conference Room A']] as Cell[][],
  statuses: [['work.ics', 'offsite', 'CANCELLED']] as Cell[][],
  recurrences: [['work.ics', 'standup', 'FREQ=WEEKLY']] as Cell[][],
}

const meta: Meta<typeof Calendar> = {
  title: 'Views/Calendar',
  component: Calendar,
}
export default meta
type Story = StoryObj<typeof Calendar>

export const Agenda: Story = {
  decorators: [
    (Story) => (
      <FlowMdHostProvider host={mockHost(CAL)}>
        <Story />
      </FlowMdHostProvider>
    ),
  ],
}

export const EmptyCalendar: Story = {
  decorators: [
    (Story) => (
      <FlowMdHostProvider host={mockHost({})}>
        <Story />
      </FlowMdHostProvider>
    ),
  ],
}
