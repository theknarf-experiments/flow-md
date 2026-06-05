import type { Fact } from '@flow-md/plugin-api'
import { describe, expect, it } from 'vitest'
import { parseIcs } from '../src/parse.js'

// Two real-ish events: one fully-populated single occurrence and one weekly
// recurring standup. CRLFs aren't strictly required (node-ical accepts \n)
// but writing them out keeps the fixture closer to what files on disk
// actually look like.
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
  'CATEGORIES:work,important',
  'DESCRIPTION:Initial project meeting',
  'ORGANIZER;CN=The Boss:mailto:boss@example.com',
  'ATTENDEE;CN=Alice:mailto:alice@example.com',
  'ATTENDEE;CN=Bob:mailto:bob@example.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-2@example.com',
  'SUMMARY:Weekly standup',
  'DTSTART:20260616T090000Z',
  'DTEND:20260616T093000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

function rows(facts: Fact[], rel: string): unknown[][] {
  return facts
    .filter((f) => f.rel === rel)
    .map((f) => f.row)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

describe('parseIcs', () => {
  const parsed = parseIcs('cal/work.ics', CAL, 1716000000000)

  it('emits a File fact with path and mtime', () => {
    expect(rows(parsed.facts, 'File')).toEqual([
      ['cal/work.ics', 1716000000000],
    ])
  })

  it('emits one Event row per VEVENT with summary + line number', () => {
    const events = rows(parsed.facts, 'Event')
    expect(events).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'Project kickoff',
      4,
    ])
    expect(events).toContainEqual([
      'cal/work.ics',
      'event-2@example.com',
      'Weekly standup',
      17,
    ])
  })

  it('emits ISO times and numeric timestamps', () => {
    const times = rows(parsed.facts, 'EventTime')
    expect(times).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      '2026-06-15T10:00:00.000Z',
      '2026-06-15T11:00:00.000Z',
    ])
    const ts = rows(parsed.facts, 'EventTimestamp')
    expect(ts).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      Date.UTC(2026, 5, 15, 10),
      Date.UTC(2026, 5, 15, 11),
    ])
  })

  it('captures location, status, description', () => {
    expect(rows(parsed.facts, 'EventLocation')).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'Conference Room A',
    ])
    expect(rows(parsed.facts, 'EventStatus')).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'CONFIRMED',
    ])
    expect(rows(parsed.facts, 'EventDescription')).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'Initial project meeting',
    ])
  })

  it('splits comma-separated categories into one row each', () => {
    const cats = rows(parsed.facts, 'EventCategory')
    expect(cats).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'work',
    ])
    expect(cats).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'important',
    ])
  })

  it('strips mailto: from attendees and organizer', () => {
    const attendees = rows(parsed.facts, 'EventAttendee')
    expect(attendees).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'alice@example.com',
    ])
    expect(attendees).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'bob@example.com',
    ])
    expect(rows(parsed.facts, 'EventOrganizer')).toContainEqual([
      'cal/work.ics',
      'event-1@example.com',
      'boss@example.com',
    ])
  })

  it('records just the RRULE body for recurring events', () => {
    const rec = rows(parsed.facts, 'EventRecurrence')
    expect(rec).toHaveLength(1)
    const [path, uid, rrule] = rec[0]!
    expect(path).toBe('cal/work.ics')
    expect(uid).toBe('event-2@example.com')
    // No leading "RRULE:" prefix and no DTSTART preamble — just the rule body.
    expect(String(rrule)).not.toMatch(/^RRULE:/i)
    expect(String(rrule)).not.toMatch(/DTSTART/i)
    expect(String(rrule)).toMatch(/FREQ=WEEKLY/)
    expect(String(rrule)).toMatch(/BYDAY=MO/)
  })

  it('emits no rules or queries (ICS is a pure fact source)', () => {
    expect(parsed.rules).toEqual([])
    expect(parsed.queries).toEqual([])
  })

  it('returns just a File fact on malformed input rather than throwing', () => {
    const garbage = parseIcs('cal/bad.ics', 'not actually ical at all', 1)
    expect(garbage.facts).toEqual([{ rel: 'File', row: ['cal/bad.ics', 1] }])
  })
})
