import { describe, expect, it } from 'vitest'
import { parseIcsDate, parseIcsEvents } from '../src/lib/ics.js'

const CAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:ev2@x',
  'SUMMARY:Later meeting\\, with agenda',
  'DTSTART:20260616T130000Z',
  'DTEND:20260616T140000Z',
  'LOCATION:Room B',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:ev1@x',
  'SUMMARY:A long title that the producer',
  ' folded onto a second line',
  'DTSTART:20260615T100000Z',
  'RRULE:FREQ=WEEKLY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:ev3@x',
  'SUMMARY:All-day thing',
  'DTSTART:20260617',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('parseIcsEvents', () => {
  const events = parseIcsEvents(CAL)

  it('parses all events, sorted by start', () => {
    expect(events.map((e) => e.uid)).toEqual(['ev1@x', 'ev2@x', 'ev3@x'])
  })

  it('unfolds folded lines and unescapes TEXT', () => {
    expect(events[0]!.summary).toBe('A long title that the producerfolded onto a second line')
    expect(events[1]!.summary).toBe('Later meeting, with agenda')
  })

  it('carries status, location and rrule through', () => {
    expect(events[1]!.status).toBe('CANCELLED')
    expect(events[1]!.location).toBe('Room B')
    expect(events[0]!.rrule).toBe('FREQ=WEEKLY')
  })

  it('flags all-day events', () => {
    expect(events[2]!.allDay).toBe(true)
    expect(events[0]!.allDay).toBe(false)
  })
})

describe('parseIcsDate', () => {
  it('parses UTC timestamps', () => {
    expect(parseIcsDate('20260615T100000Z')?.toISOString()).toBe(
      '2026-06-15T10:00:00.000Z',
    )
  })
  it('parses date-only values', () => {
    const d = parseIcsDate('20260617')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5)
    expect(d.getDate()).toBe(17)
  })
  it('rejects junk', () => {
    expect(parseIcsDate('not a date')).toBeNull()
  })
})
