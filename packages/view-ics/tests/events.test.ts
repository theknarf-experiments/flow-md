import { describe, expect, it } from 'vitest'
import { type EventRows, joinEvents } from '../src/events.js'

const rows: EventRows = {
  base: [
    ['work.ics', 'a', 'Kickoff', 4],
    ['work.ics', 'b', 'Standup', 12],
    ['work.ics', 'c', 'Offsite', 20], // no time → undated, sorts last
    ['home.ics', 'd', 'Dinner', 3],
  ],
  times: [
    ['work.ics', 'b', '2026-06-16T09:00:00.000Z', '2026-06-16T09:30:00.000Z'],
    ['work.ics', 'a', '2026-06-15T10:00:00.000Z', '2026-06-15T11:00:00.000Z'],
    ['home.ics', 'd', '2026-06-15T19:00:00.000Z', ''],
  ],
  locations: [['work.ics', 'a', 'Room A']],
  statuses: [['work.ics', 'c', 'CANCELLED']],
  recurrences: [['work.ics', 'b', 'FREQ=WEEKLY']],
}

describe('joinEvents', () => {
  it('left-joins sidecars by (path, uid) and sorts by start, undated last', () => {
    const events = joinEvents(rows)
    expect(events.map((e) => e.uid)).toEqual(['a', 'd', 'b', 'c'])
    const a = events.find((e) => e.uid === 'a')!
    expect(a).toMatchObject({ summary: 'Kickoff', location: 'Room A', start: '2026-06-15T10:00:00.000Z' })
    expect(events.find((e) => e.uid === 'b')!.rrule).toBe('FREQ=WEEKLY')
    expect(events.find((e) => e.uid === 'c')!.status).toBe('CANCELLED')
    expect(events.find((e) => e.uid === 'c')!.start).toBe('')
  })

  it('scopes to a single file when filterPath is given', () => {
    const events = joinEvents(rows, 'home.ics')
    expect(events.map((e) => e.uid)).toEqual(['d'])
    expect(events[0]!.summary).toBe('Dinner')
  })

  it('handles events with no sidecars at all', () => {
    const bare: EventRows = {
      base: [['x.ics', 'z', 'Bare', 1]],
      times: [],
      locations: [],
      statuses: [],
      recurrences: [],
    }
    expect(joinEvents(bare)).toEqual([
      { path: 'x.ics', uid: 'z', summary: 'Bare', start: '', end: '', location: '', status: '', rrule: '' },
    ])
  })
})
