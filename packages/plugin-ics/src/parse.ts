// Pure ICS → facts. node-ical handles line unfolding, parameter parsing, and
// timezone-aware Date construction; we just walk the resulting VEVENT objects
// and emit one fact per attribute we care about. RRULEs are stored as their
// canonical string (no occurrence expansion).
//
// Line numbers for events come from a quick scan of the raw text for
// `BEGIN:VEVENT`, paired with VEVENTs in declaration order. Line attribution
// is best-effort: if the count mismatches (e.g. malformed input), events
// without a match get line 0.

import type { Fact, ParseResult } from '@flow-md/plugin-api'
import nodeIcal from 'node-ical'

// node-ical is published as CommonJS; Node's native ESM loader hands us the
// module.exports object as the default import, so we reach `sync` through it.
const icalSync = nodeIcal.sync

interface VEvent {
  type?: string
  uid?: string
  summary?: string | { val?: string }
  description?: string | { val?: string }
  location?: string | { val?: string }
  status?: string
  start?: Date | string
  end?: Date | string
  categories?: unknown
  attendee?: unknown
  organizer?: unknown
  rrule?: { toString?(): string } | string
}

export function parseIcs(
  path: string,
  content: string,
  mtime: number,
): ParseResult {
  const facts: Fact[] = [{ rel: 'File', row: [path, mtime] }]

  let parsed: Record<string, unknown>
  try {
    parsed = icalSync.parseICS(content) as Record<string, unknown>
  } catch {
    return { facts, rules: [], queries: [] }
  }

  const events = Object.values(parsed).filter(
    (v): v is VEvent =>
      !!v && typeof v === 'object' && (v as VEvent).type === 'VEVENT',
  )
  const lines = scanEventLines(content)

  events.forEach((ev, i) => {
    const uid = stringOf(ev.uid)
    if (!uid) return
    const summary = stringOf(ev.summary)
    const line = lines[i] ?? 0
    facts.push({ rel: 'Event', row: [path, uid, summary, line] })

    const startIso = isoOf(ev.start)
    const endIso = isoOf(ev.end)
    if (startIso || endIso) {
      facts.push({ rel: 'EventTime', row: [path, uid, startIso, endIso] })
    }
    const startMs = msOf(ev.start)
    const endMs = msOf(ev.end)
    if (startMs !== null && endMs !== null) {
      facts.push({ rel: 'EventTimestamp', row: [path, uid, startMs, endMs] })
    }

    const location = stringOf(ev.location)
    if (location) {
      facts.push({ rel: 'EventLocation', row: [path, uid, location] })
    }
    const description = stringOf(ev.description)
    if (description) {
      facts.push({ rel: 'EventDescription', row: [path, uid, description] })
    }
    if (ev.status) {
      facts.push({ rel: 'EventStatus', row: [path, uid, String(ev.status)] })
    }
    for (const cat of categoriesOf(ev.categories)) {
      facts.push({ rel: 'EventCategory', row: [path, uid, cat] })
    }
    for (const email of emailsOf(ev.attendee)) {
      facts.push({ rel: 'EventAttendee', row: [path, uid, email] })
    }
    const organizer = singleEmailOf(ev.organizer)
    if (organizer) {
      facts.push({ rel: 'EventOrganizer', row: [path, uid, organizer] })
    }
    const rrule = rruleOf(ev.rrule)
    if (rrule) {
      facts.push({ rel: 'EventRecurrence', row: [path, uid, rrule] })
    }
  })

  return { facts: dedup(facts), rules: [], queries: [] }
}

function scanEventLines(content: string): number[] {
  const out: number[] = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().toUpperCase() === 'BEGIN:VEVENT') out.push(i + 1)
  }
  return out
}

function stringOf(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && 'val' in v && typeof (v as { val: unknown }).val === 'string') {
    return (v as { val: string }).val
  }
  return String(v)
}

function isoOf(v: unknown): string {
  if (!v) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString()
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? v : d.toISOString()
  }
  return ''
}

function msOf(v: unknown): number | null {
  if (!v) return null
  if (v instanceof Date) {
    const t = v.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof v === 'string') {
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? null : t
  }
  return null
}

function categoriesOf(v: unknown): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string') {
    return v.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function emailsOf(v: unknown): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(singleEmailOf).filter(Boolean)
  const one = singleEmailOf(v)
  return one ? [one] : []
}

function singleEmailOf(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return stripMailto(v)
  if (typeof v === 'object') {
    const o = v as { val?: string; params?: { CN?: string } }
    if (typeof o.val === 'string') return stripMailto(o.val)
  }
  return ''
}

function stripMailto(s: string): string {
  return s.replace(/^mailto:/i, '').trim()
}

function rruleOf(v: unknown): string {
  if (!v) return ''
  const s = typeof v === 'string' ? v : extractRuleString(v)
  if (!s) return ''
  // rrule.js's toString returns either "FREQ=...;..." or a multi-line block
  // like "DTSTART;TZID=...:...\nRRULE:FREQ=...;..." — keep only the RRULE
  // body so facts store a clean rule expression.
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim()
    if (t.toUpperCase().startsWith('RRULE:')) return t.slice('RRULE:'.length).trim()
  }
  return s.trim().replace(/^RRULE:/i, '').trim()
}

function extractRuleString(v: unknown): string {
  if (typeof v !== 'object' || v === null) return ''
  if ('toString' in v && typeof (v as { toString(): unknown }).toString === 'function') {
    return (v as { toString(): string }).toString()
  }
  return ''
}

const SEP = ''

function dedup(facts: Fact[]): Fact[] {
  const seen = new Set<string>()
  const out: Fact[] = []
  for (const f of facts) {
    const key = f.rel + SEP + f.row.join(SEP)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(f)
    }
  }
  return out
}
