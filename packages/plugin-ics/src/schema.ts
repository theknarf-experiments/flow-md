// EDB schema contributed by the ICS plugin. The `File` relation is shared with
// the markdown plugin (same shape) so cross-file queries can union .md and
// .ics paths without caring which plugin produced them.
//
// Each VEVENT becomes one `Event` row plus zero or more rows in the optional
// sidecar relations (location, description, status, attendees, etc.). Times
// are emitted twice: as ISO-8601 strings for display, and as numeric
// timestamps (unix ms) so queries can compare and sort them.

import type { EdbDef } from '@flow-md/plugin-api'

export const ICS_SCHEMA: EdbDef[] = [
  { name: 'File', attrs: [['path', 'string'], ['mtime', 'number']] },
  {
    name: 'Event',
    attrs: [
      ['path', 'string'],
      ['uid', 'string'],
      ['summary', 'string'],
      ['line', 'number'],
    ],
  },
  {
    name: 'EventTime',
    attrs: [
      ['path', 'string'],
      ['uid', 'string'],
      ['start', 'string'],
      ['end', 'string'],
    ],
  },
  {
    name: 'EventTimestamp',
    attrs: [
      ['path', 'string'],
      ['uid', 'string'],
      ['start', 'float'],
      ['end', 'float'],
    ],
  },
  {
    name: 'EventLocation',
    attrs: [['path', 'string'], ['uid', 'string'], ['location', 'string']],
  },
  {
    name: 'EventDescription',
    attrs: [['path', 'string'], ['uid', 'string'], ['description', 'string']],
  },
  {
    name: 'EventStatus',
    attrs: [['path', 'string'], ['uid', 'string'], ['status', 'string']],
  },
  {
    name: 'EventCategory',
    attrs: [['path', 'string'], ['uid', 'string'], ['category', 'string']],
  },
  {
    name: 'EventAttendee',
    attrs: [['path', 'string'], ['uid', 'string'], ['email', 'string']],
  },
  {
    name: 'EventOrganizer',
    attrs: [['path', 'string'], ['uid', 'string'], ['email', 'string']],
  },
  {
    name: 'EventRecurrence',
    attrs: [['path', 'string'], ['uid', 'string'], ['rrule', 'string']],
  },
]
