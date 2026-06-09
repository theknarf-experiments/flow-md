// Write-back for .ics files: rewrite one VEVENT property so an EDB fact reads
// differently. Events are located by UID — a far sturdier key than a line
// number — and properties are matched as *logical* lines (RFC 5545 folds long
// lines with leading whitespace, so a property may span several physical
// lines). Values compare and rewrite through TEXT escaping (\\ \; \, \n),
// matching what node-ical unescapes during parse.
//
// Writable columns, all keyed by (path, uid):
//   Event.summary               SUMMARY      (inserted after UID if absent)
//   EventLocation.location      LOCATION
//   EventDescription.description DESCRIPTION
//   EventStatus.status          STATUS
//
// Rewritten lines are emitted unfolded; RFC 5545's 75-octet folding is a
// SHOULD, and round-tripping through parse is unaffected.

import type { Fact, WritableRel } from '@flow-md/plugin-api'

export const ICS_WRITABLE: WritableRel[] = [
  { rel: 'Event', cols: ['summary'] },
  { rel: 'EventLocation', cols: ['location'] },
  { rel: 'EventDescription', cols: ['description'] },
  { rel: 'EventStatus', cols: ['status'] },
]

/** rel → [property name, index of its value column in the fact row]. */
const PROP: Record<string, [prop: string, valueCol: number]> = {
  Event: ['SUMMARY', 2],
  EventLocation: ['LOCATION', 2],
  EventDescription: ['DESCRIPTION', 2],
  EventStatus: ['STATUS', 2],
}

export function updateIcsFact(
  content: string,
  oldFact: Fact,
  newFact: Fact,
): string {
  const spec = PROP[oldFact.rel]
  if (!spec || oldFact.rel !== newFact.rel) {
    throw new Error(`relation "${oldFact.rel}" is not writable by the ics plugin`)
  }
  const [prop, valueCol] = spec
  for (let i = 0; i < oldFact.row.length; i++) {
    if (i !== valueCol && oldFact.row[i] !== newFact.row[i]) {
      throw new Error(`only the ${prop.toLowerCase()} value of ${oldFact.rel} is writable`)
    }
  }
  const uid = String(oldFact.row[1] ?? '')
  const oldValue = String(oldFact.row[valueCol] ?? '')
  const newValue = String(newFact.row[valueCol] ?? '')

  const lines = content.split('\n')
  const block = eventBlockOf(lines, uid)
  const at = logicalLineOf(lines, block, prop)

  if (!at) {
    // Only Event carries a fact even when the property is missing (summary
    // defaults to ""); the sidecar relations exist iff their property does.
    if (oldFact.rel !== 'Event' || oldValue !== '') {
      throw new Error(`event "${uid}" has no ${prop} property`)
    }
    const uidAt = logicalLineOf(lines, block, 'UID')!
    lines.splice(uidAt.end + 1, 0, `${prop}:${escapeText(newValue)}` + eol(lines))
    return lines.join('\n')
  }

  if (unescapeText(at.value) !== oldValue) {
    throw new Error(
      `${prop} of event "${uid}" is "${unescapeText(at.value)}", not "${oldValue}"`,
    )
  }
  lines.splice(
    at.start,
    at.end - at.start + 1,
    at.prefix + escapeText(newValue) + eol(lines),
  )
  return lines.join('\n')
}

// --- structure helpers ------------------------------------------------------

interface Block {
  /** Physical line indexes of BEGIN:VEVENT / END:VEVENT. */
  begin: number
  end: number
}

interface LogicalLine {
  /** Physical line range (inclusive) of the folded property. */
  start: number
  end: number
  /** Property name + params + the colon, exactly as written. */
  prefix: string
  /** Unfolded raw value (still TEXT-escaped). */
  value: string
}

function eventBlockOf(lines: string[], uid: string): Block {
  let begin = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim().toUpperCase()
    if (t === 'BEGIN:VEVENT') begin = i
    else if (t === 'END:VEVENT' && begin >= 0) {
      const block = { begin, end: i }
      const u = logicalLineOf(lines, block, 'UID')
      if (u && unescapeText(u.value) === uid) return block
      begin = -1
    }
  }
  throw new Error(`no VEVENT with UID "${uid}"`)
}

/** Find `prop` as a logical (unfolded) line inside the block. */
function logicalLineOf(
  lines: string[],
  block: Block,
  prop: string,
): LogicalLine | null {
  for (let i = block.begin + 1; i < block.end; i++) {
    const line = lines[i]!
    if (/^[ \t]/.test(line)) continue // continuation of a previous line
    const colon = colonOutsideQuotes(line)
    if (colon < 0) continue
    const name = line.slice(0, colon).split(';')[0]!.trim().toUpperCase()
    if (name !== prop) continue
    let end = i
    let value = line.slice(colon + 1)
    while (end + 1 < block.end && /^[ \t]/.test(lines[end + 1]!)) {
      end++
      value = value.replace(/\r$/, '') + lines[end]!.slice(1)
    }
    return {
      start: i,
      end,
      prefix: line.slice(0, colon + 1),
      value: value.replace(/\r$/, ''),
    }
  }
  return null
}

/** First `:` outside double quotes — params may quote colons (e.g. URIs). */
function colonOutsideQuotes(line: string): number {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (c === ':' && !quoted) return i
  }
  return -1
}

/** "\r" when the file uses CRLF line endings (sampled from the first line). */
function eol(lines: string[]): string {
  return lines[0]?.endsWith('\r') ? '\r' : ''
}

// --- RFC 5545 TEXT escaping ---------------------------------------------------

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_, c: string) =>
    c === 'n' || c === 'N' ? '\n' : c,
  )
}
