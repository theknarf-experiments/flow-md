---
title: Calendar
tags: [reference]
order: 8
---

# Calendar

flow-md isn't only for markdown. The **ICS plugin** indexes any `.ics` file in
the vault, turning every `VEVENT` into a row in the `Event` relation (plus
sidecar relations for location, attendees, recurrence, and so on). Queries
written here in markdown can join across both kinds of files in one go.

This page is backed by two example calendars in this vault: [[work]] and
[[personal]]. The queries below are live — edit either `.ics` file and the
tables here re-render.

## Schema

| Relation            | Columns                                                           |
|---------------------|-------------------------------------------------------------------|
| `Event`             | `path: string, uid: string, summary: string, line: number`        |
| `EventTime`         | `path: string, uid: string, start: string, end: string` (ISO)     |
| `EventTimestamp`    | `path: string, uid: string, start: float, end: float` (unix ms)   |
| `EventLocation`     | `path: string, uid: string, location: string`                     |
| `EventDescription`  | `path: string, uid: string, description: string`                  |
| `EventStatus`       | `path: string, uid: string, status: string`                       |
| `EventCategory`     | `path: string, uid: string, category: string` (one row per)       |
| `EventAttendee`     | `path: string, uid: string, email: string`                        |
| `EventOrganizer`    | `path: string, uid: string, email: string`                        |
| `EventRecurrence`   | `path: string, uid: string, rrule: string` (RRULE body only)      |

The ICS plugin also contributes a `File(path, mtime)` row per `.ics` file —
the same relation the markdown plugin uses — so `File(p, _)` lists *every*
indexed file in the vault, regardless of format.

## Every event in the vault

```datalog-query
Event(path, uid, summary, line)
```

## Event summaries with their start time

A small rule joins `Event` and `EventTime` so the result is a friendlier
shape — calendar file, what, when:

```datalog
EventBrief(file, summary, start) :-
  Event(file, uid, summary, _),
  EventTime(file, uid, start, _).
```

```datalog-query
EventBrief(file, summary, start)
```

## Recurring events

Anything with an `RRULE`:

```datalog-query
EventRecurrence(path, uid, rrule)
```

## Events Alice is invited to

A pinned-string query: keep the email constant and let the engine fill in the
rest.

```datalog-query
Event(path, uid, summary, _), EventAttendee(path, uid, "alice@flow-md.example")
```

## Events with more than one attendee

A two-step rule: pair distinct attendees on the same event, then a second
relation projects out their shared event.

```datalog
EventPair(uid, a, b) :-
  EventAttendee(path, uid, a),
  EventAttendee(path, uid, b),
  a != b.

GroupEvent(uid, summary) :-
  Event(_, uid, summary, _),
  EventPair(uid, _, _).
```

```datalog-query
GroupEvent(uid, summary)
```

## Events by location

```datalog-query
EventLocation(path, uid, location), Event(path, uid, summary, _)
```

## Where to go next

- [[schema]] — the markdown-side relations.
- [[writing-queries]] — how variable names become columns, how to pin
  values with string constants, and the rest of the basics.
- [[writing-rules]] — defining your own relations (`EventBrief`, `GroupEvent`
  above) instead of repeating joins in every query.
