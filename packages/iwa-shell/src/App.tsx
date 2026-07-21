// The IWA shell: a browser wrapper whose tabs we own.
//
// Chrome gives us one app window; the tab strip, address bar, navigation and
// lifecycle are all ours, because every tab is a <controlledframe> we create
// and control. flow-md is just a tab — an ordinary page served by the local
// process — so it keeps runtime MDX evaluation and everything else a normal
// web page can do. The strict IWA CSP applies to *this* document, not to
// guests.
//
// React owns the chrome only; guests live in lib/frames.ts, outside
// reconciliation, so a re-render can never throw a loaded page away.

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './App.module.css'
import { controlledFrame, cspSelfTest } from './lib/env.js'
import { type FrameHandle, createFrame, normalizeUrl } from './lib/frames.js'

/** One shared partition, so tabs behave like a single browser profile and
 *  logins persist. Per-space containers would just be another persist: name. */
const PARTITION = 'persist:flow-md'
const HOME = 'http://localhost:4748/'

interface Tab {
  id: number
  title: string
  url: string
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [nav, setNav] = useState({ back: false, forward: false })
  const [lines, setLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)

  const contentRef = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<number, FrameHandle>())
  const seq = useRef(0)
  const editing = useRef(false)
  /** Creating guests is an imperative side effect, and StrictMode invokes
   *  effects twice in dev — without this we boot two of every tab. */
  const booted = useRef(false)

  const log = useCallback((msg: string) => setLines((l) => [msg, ...l].slice(0, 200)), [])

  const active = tabs.find((t) => t.id === activeId) ?? null
  const activeFrame = activeId !== null ? frames.current.get(activeId) : undefined

  /** Pull the guest's real title/url back out after it navigates. */
  const sync = useCallback(
    async (id: number) => {
      const frame = frames.current.get(id)
      if (!frame) return
      const info = await frame.probe()
      if (info) {
        setTabs((ts) =>
          ts.map((t) => (t.id === id ? { ...t, title: info.title || info.url, url: info.url } : t)),
        )
      }
      setNav({ back: await frame.canGoBack(), forward: await frame.canGoForward() })
    },
    [],
  )

  const openTab = useCallback(
    (url: string, activate = true) => {
      const container = contentRef.current
      if (!container) return
      const id = ++seq.current
      const frame = createFrame(url, PARTITION, container, styles.frameActive!, () => {
        void sync(id)
      })
      frames.current.set(id, frame)
      setTabs((ts) => [...ts, { id, title: url, url }])
      if (activate) setActiveId(id)
      log(`tab ${id} → ${url}`)
    },
    [log, sync],
  )

  const closeTab = useCallback(
    (id: number) => {
      frames.current.get(id)?.destroy()
      frames.current.delete(id)
      setTabs((ts) => {
        const i = ts.findIndex((t) => t.id === id)
        const next = ts.filter((t) => t.id !== id)
        setActiveId((current) => {
          if (current !== id) return current
          return (next[i] ?? next[i - 1])?.id ?? null
        })
        return next
      })
      log(`closed tab ${id}`)
    },
    [log],
  )

  // Boot: one flow-md tab, one third-party tab to prove arbitrary sites load.
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    for (const line of cspSelfTest()) log(line)
    log(
      controlledFrame.available
        ? `controlledframe: ${controlledFrame.detail}`
        : `controlledframe MISSING — ${controlledFrame.detail}`,
    )
    openTab(HOME)
    openTab('https://example.com', false)
    // Boot once; openTab is stable but we explicitly want no re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Show only the active guest.
  useEffect(() => {
    for (const [id, frame] of frames.current) frame.setActive(id === activeId)
    if (activeId !== null) void sync(activeId)
  }, [activeId, tabs.length, sync])

  // Keep the address bar in step unless the user is typing in it.
  useEffect(() => {
    if (!editing.current) setDraft(active?.url ?? '')
  }, [active?.url])

  // Browser-ish shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 't') {
        e.preventDefault()
        openTab(HOME)
      } else if (e.key === 'w') {
        e.preventDefault()
        if (activeId !== null) closeTab(activeId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, closeTab, openTab])

  const go = (value: string) => {
    if (!activeFrame || activeId === null) return
    const url = normalizeUrl(value, HOME)
    activeFrame.navigate(url)
    setTabs((ts) => ts.map((t) => (t.id === activeId ? { ...t, url } : t)))
    log(`navigate → ${url}`)
  }

  const capture = async () => {
    if (!activeFrame) return
    setShowLog(true)
    const info = await activeFrame.probe()
    log(info ? `capture → ${JSON.stringify(info)}` : 'capture failed (no executeScript)')
  }

  return (
    <div className={styles.shell}>
      {!controlledFrame.available && (
        <div className={styles.banner}>
          {`<controlledframe> unavailable — ${controlledFrame.detail}\n` +
            'Falling back to <iframe>; most sites will refuse to load.\n' +
            'Run: mise run iwa'}
        </div>
      )}

      <nav className={styles.tabs} aria-label="tabs">
        <div className={styles.strip}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`${styles.tab} ${tab.id === activeId ? styles.active : ''}`}
              onClick={() => setActiveId(tab.id)}
              title={tab.url}
            >
              <span className={styles.label}>{tab.title}</span>
              <span
                role="button"
                tabIndex={-1}
                aria-label="close tab"
                className={styles.close}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                ✕
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.button} ${styles.newTab}`}
          onClick={() => openTab(HOME)}
          title="new tab (⌘T)"
        >
          +
        </button>
      </nav>

      <header className={styles.bar}>
        <button
          type="button"
          className={styles.button}
          disabled={!nav.back}
          onClick={() => activeFrame?.back()}
          title="back"
        >
          ‹
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={!nav.forward}
          onClick={() => activeFrame?.forward()}
          title="forward"
        >
          ›
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => activeFrame?.reload()}
          title="reload"
        >
          ⟳
        </button>
        <input
          className={styles.url}
          value={draft}
          spellCheck={false}
          placeholder="url…"
          onFocus={() => {
            editing.current = true
          }}
          onBlur={() => {
            editing.current = false
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              go(draft)
              e.currentTarget.blur()
            }
          }}
        />
        <button type="button" className={styles.button} onClick={() => void capture()}>
          capture
        </button>
        <button type="button" className={styles.button} onClick={() => setShowLog((s) => !s)}>
          log
        </button>
      </header>

      <main className={styles.content} ref={contentRef} />

      {showLog && (
        <aside className={styles.log} aria-label="log">
          {lines.map((line, i) => (
            <p
              // Log lines are append-only and never reordered.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={i}
              className={line.includes('blocked') ? styles.ok : line.includes('MISSING') ? styles.err : ''}
            >
              {line}
            </p>
          ))}
        </aside>
      )}
    </div>
  )
}
