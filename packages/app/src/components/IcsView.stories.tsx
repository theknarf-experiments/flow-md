import type { Meta, StoryObj } from '@storybook/react-vite'
import { IcsView } from './IcsView.js'

const CAL = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:kickoff@x',
  'SUMMARY:Project kickoff',
  'DTSTART:20260615T100000Z',
  'DTEND:20260615T110000Z',
  'LOCATION:Conference Room A',
  'DESCRIPTION:Bring the roadmap',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:standup@x',
  'SUMMARY:Weekly standup',
  'DTSTART:20260616T090000Z',
  'DTEND:20260616T093000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:offsite@x',
  'SUMMARY:Team offsite',
  'DTSTART:20260617',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const meta: Meta<typeof IcsView> = {
  title: 'Views/IcsView',
  component: IcsView,
}
export default meta
type Story = StoryObj<typeof IcsView>

export const Agenda: Story = {
  args: { content: CAL },
}

export const EmptyCalendar: Story = {
  args: { content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' },
}
