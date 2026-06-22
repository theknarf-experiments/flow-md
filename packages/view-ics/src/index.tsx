// Datalog-driven calendar — a flow-md view plugin. It reads the ICS plugin's
// Event* facts off the server (no client-side .ics parsing) and renders a
// date-grouped agenda. Two homes:
//
//   • the default viewer for `.ics` files (registered as a fileHandler), and
//   • an MDX component: <Calendar /> shows every event in the vault,
//     <Calendar path="cal/work.ics" /> scopes to one file.
//
// Events come from Event(path, uid, summary, line); start/end, location,
// status and recurrence are optional sidecar relations left-joined client-
// side (see events.ts). Because it's just queries, edits to the underlying
// .ics (via the ICS plugin's write-back) show up here live.

import { type CalEvent, joinEvents } from './events.js'
import { type FlowMdViewPlugin, useFlowMd } from '@flow-md/view-api'
import { useMemo } from 'react'
import styles from './Calendar.module.css'

const INTERVAL = 5000

export function Calendar(props: { path?: string }) {
  const host = useFlowMd()
  const base = host.useQuery('Event(path, uid, summary, line)', { intervalMs: INTERVAL })
  const times = host.useQuery('EventTime(path, uid, start, end)', { intervalMs: INTERVAL })
  const locations = host.useQuery('EventLocation(path, uid, location)', { intervalMs: INTERVAL })
  const statuses = host.useQuery('EventStatus(path, uid, status)', { intervalMs: INTERVAL })
  const recurrences = host.useQuery('EventRecurrence(path, uid, rrule)', { intervalMs: INTERVAL })

  const events = useMemo(
    () =>
      joinEvents(
        {
          base: base.rows,
          times: times.rows,
          locations: locations.rows,
          statuses: statuses.rows,
          recurrences: recurrences.rows,
        },
        props.path,
      ),
    [base.rows, times.rows, locations.rows, statuses.rows, recurrences.rows, props.path],
  )

  const byDay = useMemo(() => {
    const groups = new Map<string, CalEvent[]>()
    for (const ev of events) {
      const day = ev.start ? dayLabel(ev.start) : 'undated'
      const list = groups.get(day) ?? []
      list.push(ev)
      groups.set(day, list)
    }
    return [...groups.entries()]
  }, [events])

  if (base.error) return <p className="offline">calendar: {base.error}</p>
  if (base.ready && events.length === 0) {
    return <p className="hint">no events in this calendar</p>
  }

  return (
    <div className={styles.agenda} data-testid="calendar">
      {byDay.map(([day, list]) => (
        <section key={day}>
          <h3 className={styles.day}>{day}</h3>
          <ul className={styles.events}>
            {list.map((ev) => (
              <li
                key={`${ev.path} ${ev.uid}`}
                className={styles.event}
                data-cancelled={ev.status === 'CANCELLED' || undefined}
              >
                <span className={styles.time}>
                  {ev.start ? timeRange(ev) : 'all day'}
                </span>
                <span className={styles.body}>
                  <span className={styles.summary}>
                    {ev.summary || '(untitled)'}
                    {ev.rrule && (
                      <span className={styles.badge} title={ev.rrule}>
                        ↻
                      </span>
                    )}
                    {ev.status && ev.status !== 'CONFIRMED' && (
                      <span className={styles.badge}>{ev.status.toLowerCase()}</span>
                    )}
                  </span>
                  {ev.location && (
                    <span className={styles.detail}>📍 {ev.location}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function timeRange(ev: CalEvent): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return ev.end ? `${fmt(ev.start)}–${fmt(ev.end)}` : fmt(ev.start)
}

/** The default viewer for `.ics` files: the calendar scoped to that file. */
function IcsFileView({ path }: { path: string }) {
  return <Calendar path={path} />
}

export const icsViewPlugin: FlowMdViewPlugin = {
  name: 'ics-view',
  components: { Calendar },
  fileHandlers: { '.ics': IcsFileView },
}

export default icsViewPlugin
export { joinEvents } from './events.js'
export type { CalEvent } from './events.js'
