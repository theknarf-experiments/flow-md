import { describe, expect, it } from 'vitest'
import { parseIcs } from '../src/parse.js'
import { updateIcsFact } from '../src/update.js'

const CAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//flow-md-test//EN',
  'BEGIN:VEVENT',
  'UID:event-1@example.com',
  'SUMMARY:Project kickoff',
  'DTSTART:20260615T100000Z',
  'DTEND:20260615T110000Z',
  'LOCATION:Conference Room A',
  'STATUS:CONFIRMED',
  'DESCRIPTION:Initial project meeting\\, with agenda',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-2@example.com',
  'DTSTART:20260616T090000Z',
  'DTEND:20260616T093000Z',
  'SUMMARY:A rather long meeting title that the producer',
  ' decided to fold across two physical lines',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

/** The rewrite must stay consistent under reparse. */
function roundTrip(
  content: string,
  oldFact: { rel: string; row: (string | number)[] },
  newFact: { rel: string; row: (string | number)[] },
): string {
  const updated = updateIcsFact(content, oldFact, newFact)
  const facts = parseIcs('c.ics', updated, 0).facts
  const has = (f: typeof oldFact) =>
    facts.some((g) => g.rel === f.rel && JSON.stringify(g.row) === JSON.stringify(f.row))
  expect(has(newFact)).toBe(true)
  expect(has(oldFact)).toBe(false)
  return updated
}

describe('updateIcsFact', () => {
  it('rewrites a SUMMARY by UID', () => {
    const updated = roundTrip(
      CAL,
      { rel: 'Event', row: ['c.ics', 'event-1@example.com', 'Project kickoff', 4] },
      { rel: 'Event', row: ['c.ics', 'event-1@example.com', 'Project kickoff (moved)', 4] },
    )
    expect(updated).toContain('SUMMARY:Project kickoff (moved)\r')
  })

  it('rewrites LOCATION and STATUS', () => {
    roundTrip(
      CAL,
      { rel: 'EventLocation', row: ['c.ics', 'event-1@example.com', 'Conference Room A'] },
      { rel: 'EventLocation', row: ['c.ics', 'event-1@example.com', 'Room B'] },
    )
    roundTrip(
      CAL,
      { rel: 'EventStatus', row: ['c.ics', 'event-1@example.com', 'CONFIRMED'] },
      { rel: 'EventStatus', row: ['c.ics', 'event-1@example.com', 'CANCELLED'] },
    )
  })

  it('compares and writes through TEXT escaping', () => {
    const updated = roundTrip(
      CAL,
      {
        rel: 'EventDescription',
        row: ['c.ics', 'event-1@example.com', 'Initial project meeting, with agenda'],
      },
      {
        rel: 'EventDescription',
        row: ['c.ics', 'event-1@example.com', 'New; plan, etc.'],
      },
    )
    expect(updated).toContain('DESCRIPTION:New\\; plan\\, etc.\r')
  })

  it('matches a folded property as one logical line', () => {
    const folded =
      'A rather long meeting title that the producerdecided to fold across two physical lines'
    const updated = roundTrip(
      CAL,
      { rel: 'Event', row: ['c.ics', 'event-2@example.com', folded, 13] },
      { rel: 'Event', row: ['c.ics', 'event-2@example.com', 'Short title', 13] },
    )
    expect(updated).toContain('SUMMARY:Short title\r')
    expect(updated).not.toContain(' decided to fold')
  })

  it('inserts a SUMMARY when the event has none', () => {
    const noSummary = CAL.replace('SUMMARY:Project kickoff\r\n', '')
    const updated = updateIcsFact(
      noSummary,
      { rel: 'Event', row: ['c.ics', 'event-1@example.com', '', 4] },
      { rel: 'Event', row: ['c.ics', 'event-1@example.com', 'Fresh title', 4] },
    )
    expect(updated).toContain('UID:event-1@example.com\r\nSUMMARY:Fresh title\r')
  })

  it('rejects stale values, unknown UIDs and read-only relations', () => {
    expect(() =>
      updateIcsFact(
        CAL,
        { rel: 'Event', row: ['c.ics', 'event-1@example.com', 'Wrong title', 4] },
        { rel: 'Event', row: ['c.ics', 'event-1@example.com', 'New', 4] },
      ),
    ).toThrow(/is "Project kickoff", not "Wrong title"/)
    expect(() =>
      updateIcsFact(
        CAL,
        { rel: 'Event', row: ['c.ics', 'nope@example.com', 'x', 4] },
        { rel: 'Event', row: ['c.ics', 'nope@example.com', 'y', 4] },
      ),
    ).toThrow(/no VEVENT with UID/)
    expect(() =>
      updateIcsFact(
        CAL,
        { rel: 'EventTime', row: ['c.ics', 'event-1@example.com', 'a', 'b'] },
        { rel: 'EventTime', row: ['c.ics', 'event-1@example.com', 'a', 'c'] },
      ),
    ).toThrow(/not writable by the ics plugin/)
  })

  it('rejects edits to key columns', () => {
    expect(() =>
      updateIcsFact(
        CAL,
        { rel: 'Event', row: ['c.ics', 'event-1@example.com', 'Project kickoff', 4] },
        { rel: 'Event', row: ['c.ics', 'other@example.com', 'Project kickoff', 4] },
      ),
    ).toThrow(/only the summary value/)
  })
})
