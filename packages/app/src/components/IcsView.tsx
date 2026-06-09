// Calendar file view: VEVENTs as a date-grouped agenda list. Read-only —
// edits go through the edit (raw text) mode or the Datalog update path.

import { useMemo } from 'react'
import { type IcsEvent, parseIcsEvents } from '../lib/ics.js'
import styles from './IcsView.module.css'

export function IcsView({ content }: { content: string }) {
  const events = useMemo(() => parseIcsEvents(content), [content])

  const byDay = useMemo(() => {
    const groups = new Map<string, IcsEvent[]>()
    for (const ev of events) {
      const day = ev.start ? dayLabel(ev.start) : 'undated'
      const list = groups.get(day) ?? []
      list.push(ev)
      groups.set(day, list)
    }
    return [...groups.entries()]
  }, [events])

  if (events.length === 0) {
    return <p className="hint">no events in this calendar</p>
  }

  return (
    <div className={styles.agenda} data-testid="ics-view">
      {byDay.map(([day, list]) => (
        <section key={day}>
          <h3 className={styles.day}>{day}</h3>
          <ul className={styles.events}>
            {list.map((ev) => (
              <li
                key={ev.uid + (ev.start?.toISOString() ?? '')}
                className={styles.event}
                data-cancelled={ev.status === 'CANCELLED' || undefined}
              >
                <span className={styles.time}>
                  {ev.allDay || !ev.start ? 'all day' : timeRange(ev)}
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
                  {ev.description && (
                    <span className={styles.detail}>{ev.description}</span>
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

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function timeRange(ev: IcsEvent): string {
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (!ev.start) return ''
  return ev.end ? `${fmt(ev.start)}–${fmt(ev.end)}` : fmt(ev.start)
}
