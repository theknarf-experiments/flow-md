// Minimal client-side ICS reader for the calendar view: unfold logical
// lines, walk VEVENT blocks, pull the display-relevant properties. This is
// deliberately *much* smaller than the server's node-ical-based plugin — the
// app only needs enough to render an event list, and parsing locally keeps
// the view working offline.

export interface IcsEvent {
  uid: string
  summary: string
  location: string
  description: string
  status: string
  /** Parsed start/end; null when absent or unparseable. */
  start: Date | null
  end: Date | null
  /** True for date-only (all-day) starts. */
  allDay: boolean
  rrule: string
}

export function parseIcsEvents(content: string): IcsEvent[] {
  const lines = unfold(content)
  const events: IcsEvent[] = []
  let cur: Record<string, string> | null = null
  for (const line of lines) {
    const upper = line.trim().toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      cur = {}
      continue
    }
    if (upper === 'END:VEVENT') {
      if (cur) events.push(toEvent(cur))
      cur = null
      continue
    }
    if (!cur) continue
    const colon = colonOutsideQuotes(line)
    if (colon < 0) continue
    const name = line.slice(0, colon).split(';')[0]!.trim().toUpperCase()
    cur[name] = unescapeText(line.slice(colon + 1))
  }
  return events.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
}

function toEvent(props: Record<string, string>): IcsEvent {
  const rawStart = props['DTSTART'] ?? ''
  return {
    uid: props['UID'] ?? '',
    summary: props['SUMMARY'] ?? '',
    location: props['LOCATION'] ?? '',
    description: props['DESCRIPTION'] ?? '',
    status: props['STATUS'] ?? '',
    start: parseIcsDate(rawStart),
    end: parseIcsDate(props['DTEND'] ?? ''),
    allDay: /^\d{8}$/.test(rawStart.trim()),
    rrule: props['RRULE'] ?? '',
  }
}

/** RFC 5545 folds long lines with CRLF + leading whitespace. */
function unfold(content: string): string[] {
  const out: string[] = []
  for (const line of content.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

/** `20260615T100000Z`, `20260615T100000` (floating/TZID — read as local
 *  clock time) or `20260615` (all-day). */
export function parseIcsDate(raw: string): Date | null {
  const s = raw.trim()
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, se, z] = m
  const date = z
    ? new Date(
        Date.UTC(+y!, +mo! - 1, +d!, +(h ?? 0), +(mi ?? 0), +(se ?? 0)),
      )
    : new Date(+y!, +mo! - 1, +d!, +(h ?? '0'), +(mi ?? '0'), +(se ?? '0'))
  return Number.isNaN(date.getTime()) ? null : date
}

function colonOutsideQuotes(line: string): number {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (c === ':' && !quoted) return i
  }
  return -1
}

function unescapeText(s: string): string {
  return s
    .replace(/\r$/, '')
    .replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}
