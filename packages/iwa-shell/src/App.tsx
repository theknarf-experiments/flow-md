// The IWA shell: an Arc-shaped browser whose tabs we own.
//
// Chrome gives us one app window; the sidebar, spaces, command bar and tab
// lifecycle are all ours, because every tab is a <controlledframe> we create
// and control. flow-md is just a tab — an ordinary page served by the local
// process — so it keeps runtime MDX evaluation and everything else a normal
// web page can do. The strict IWA CSP applies to *this* document, not guests.
//
// Arc-isms worth naming: tabs live in a vertical sidebar rather than a strip,
// pinned tabs sit above ephemeral ones, each space has its own gradient and
// its own tab set, and there's no persistent address bar — ⌘L/⌘T open a
// floating command bar instead.
//
// React owns the chrome only; guests live in lib/frames.ts, outside
// reconciliation, so a re-render can never throw a loaded page away.

import {
  AddressPill,
  Banner,
  CommandPalette,
  type PaletteItem,
  IconButton,
  LogPanel,
  SectionLabel,
  Sidebar,
  SpaceRail,
  SidebarButton,
  Spacer,
  Tab as TabRow,
  Toolbar,
  fuzzyFilter,
} from '@flow-md/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import {
  controlledFrame,
  cspSelfTest,
  hasTitleBar,
  requestWindowManagement,
  windowManagementState,
} from './lib/env.js'
import { type FrameHandle, createFrame, normalizeUrl } from './lib/frames.js'

const HOME = 'http://localhost:4748/'

interface Space {
  id: string
  name: string
  /** Base hue for the gradient; each space feels distinct, as in Arc. */
  hue: number
  /** Guests are partitioned per space, so spaces are real containers:
   *  separate cookies, storage and logins. */
  partition: string
}

const SPACES: Space[] = [
  { id: 'vault', name: 'Vault', hue: 250, partition: 'persist:vault' },
  { id: 'web', name: 'Web', hue: 190, partition: 'persist:web' },
  { id: 'scratch', name: 'Scratch', hue: 320, partition: 'persist:scratch' },
]

interface Tab {
  id: number
  spaceId: string
  title: string
  url: string
  pinned: boolean
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [spaceId, setSpaceId] = useState(SPACES[0]!.id)
  /** Active tab per space, so switching spaces restores where you were. */
  const [activeBySpace, setActiveBySpace] = useState<Record<string, number | null>>({})
  const [nav, setNav] = useState({ back: false, forward: false })
  const [sidebar, setSidebar] = useState(true)
  const [command, setCommand] = useState<{ open: boolean; value: string; newTab: boolean }>({
    open: false,
    value: '',
    newTab: false,
  })
  const [lines, setLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  /** Shown only while Chrome still draws a title bar we could get rid of. */
  const [offerUnframe, setOfferUnframe] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<number, FrameHandle>())
  const seq = useRef(0)
  /** Creating guests is an imperative side effect, and StrictMode invokes
   *  effects twice in dev — without this we boot two of every tab. */
  const booted = useRef(false)

  const space = SPACES.find((s) => s.id === spaceId) ?? SPACES[0]!
  const activeId = activeBySpace[spaceId] ?? null
  const active = tabs.find((t) => t.id === activeId) ?? null
  const activeFrame = activeId !== null ? frames.current.get(activeId) : undefined

  const log = useCallback((msg: string) => setLines((l) => [msg, ...l].slice(0, 200)), [])

  const spaceTabs = useMemo(() => tabs.filter((t) => t.spaceId === spaceId), [tabs, spaceId])
  const pinned = spaceTabs.filter((t) => t.pinned)
  const loose = spaceTabs.filter((t) => !t.pinned)

  /** Pull the guest's real title/url back out after it navigates. */
  const sync = useCallback(async (id: number) => {
    const frame = frames.current.get(id)
    if (!frame) return
    const info = await frame.probe()
    if (info) {
      setTabs((ts) =>
        ts.map((t) => (t.id === id ? { ...t, title: info.title || info.url, url: info.url } : t)),
      )
    }
    setNav({ back: await frame.canGoBack(), forward: await frame.canGoForward() })
  }, [])

  const openTab = useCallback(
    (url: string, opts: { space?: string; pinned?: boolean; activate?: boolean } = {}) => {
      const container = cardRef.current
      if (!container) return
      const target = opts.space ?? spaceId
      const partition = (SPACES.find((s) => s.id === target) ?? SPACES[0]!).partition
      const id = ++seq.current
      const frame = createFrame(url, partition, container, styles.frameActive!, () => {
        void sync(id)
      })
      frames.current.set(id, frame)
      setTabs((ts) => [...ts, { id, spaceId: target, title: url, url, pinned: !!opts.pinned }])
      if (opts.activate !== false) setActiveBySpace((m) => ({ ...m, [target]: id }))
      log(`tab ${id} → ${url}`)
    },
    [spaceId, log, sync],
  )

  const closeTab = useCallback(
    (id: number) => {
      frames.current.get(id)?.destroy()
      frames.current.delete(id)
      setTabs((ts) => {
        const victim = ts.find((t) => t.id === id)
        const next = ts.filter((t) => t.id !== id)
        if (victim) {
          const siblings = next.filter((t) => t.spaceId === victim.spaceId)
          setActiveBySpace((m) =>
            m[victim.spaceId] === id
              ? { ...m, [victim.spaceId]: siblings[siblings.length - 1]?.id ?? null }
              : m,
          )
        }
        return next
      })
      log(`closed tab ${id}`)
    },
    [log],
  )

  // Boot: flow-md pinned in the Vault space, a site in Web.
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    for (const line of cspSelfTest()) log(line)
    log(
      controlledFrame.available
        ? `controlledframe: ${controlledFrame.detail}`
        : `controlledframe MISSING — ${controlledFrame.detail}`,
    )
    openTab(HOME, { space: 'vault', pinned: true })
    openTab('https://example.com', { space: 'web', activate: false })
    void windowManagementState().then((state) => {
      log(`window-management: ${state} · title bar: ${hasTitleBar()}`)
      setOfferUnframe(hasTitleBar() && state !== 'granted' && state !== 'unsupported')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A space with tabs but no active one (opened in the background, or its
  // active tab was closed) should show its first tab rather than a blank card.
  useEffect(() => {
    if (activeBySpace[spaceId] != null) return
    const first = tabs.find((t) => t.spaceId === spaceId)
    if (first) setActiveBySpace((m) => ({ ...m, [spaceId]: first.id }))
  }, [spaceId, tabs, activeBySpace])

  // Only the active tab of the active space is visible.
  useEffect(() => {
    for (const [id, frame] of frames.current) frame.setActive(id === activeId)
    if (activeId !== null) void sync(activeId)
  }, [activeId, tabs.length, sync])

  const go = useCallback(
    (value: string, asNewTab: boolean) => {
      const url = normalizeUrl(value, HOME)
      if (asNewTab || !activeFrame || activeId === null) {
        openTab(url)
      } else {
        activeFrame.navigate(url)
        setTabs((ts) => ts.map((t) => (t.id === activeId ? { ...t, url } : t)))
        log(`navigate → ${url}`)
      }
    },
    [activeFrame, activeId, openTab, log],
  )

  // Arc-ish shortcuts: ⌘T new tab, ⌘L edit address, ⌘S sidebar, ⌘W close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setCommand((c) => ({ ...c, open: false }))
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 't') {
        e.preventDefault()
        setCommand({ open: true, value: '', newTab: true })
      } else if (e.key === 'l') {
        e.preventDefault()
        setCommand({ open: true, value: active?.url ?? '', newTab: false })
      } else if (e.key === 's') {
        e.preventDefault()
        setSidebar((s) => !s)
      } else if (e.key === 'w') {
        e.preventDefault()
        if (activeId !== null) closeTab(activeId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active?.url, activeId, closeTab])

  /** The shell's ⌘T/⌘L results — the same searchable palette the app uses,
   *  just over tabs and shell commands instead of vault notes. Typing a URL
   *  offers it as the top entry, so free-text entry survives. */
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const q = command.value.trim()
    const items: PaletteItem[] = []

    // Only offer navigation when the text actually looks like somewhere to
    // go. normalizeUrl() will happily turn "side" into http://side, which is
    // noise next to a command called "Toggle sidebar".
    const navigable =
      /^[a-z]+:\/\//i.test(q) ||
      /^localhost(:\d+)?([/?#]|$)/i.test(q) ||
      /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(q) ||
      q.startsWith('/')

    const navigate = (value: string): PaletteItem => ({
      key: 'open',
      icon: navigable ? '↵' : '🔍',
      label: navigable
        ? `${command.newTab ? 'Open' : 'Go to'} ${normalizeUrl(value, HOME)}`
        : `Search the web for “${value}”`,
      run: () => {
        go(value, command.newTab)
        setCommand((c) => ({ ...c, open: false }))
      },
    })

    if (q && navigable) items.push(navigate(q))

    const tabItems: PaletteItem[] = tabs.map((t) => {
      const space = SPACES.find((sp) => sp.id === t.spaceId)
      return {
        key: `tab:${t.id}`,
        icon: '▤',
        label: t.title,
        detail: space?.name,
        run: () => {
          setSpaceId(t.spaceId)
          setActiveBySpace((m) => ({ ...m, [t.spaceId]: t.id }))
          setCommand((c) => ({ ...c, open: false }))
        },
      }
    })

    const commandItems: PaletteItem[] = [
      { key: 'cmd:newtab', icon: '⌘', label: 'New tab', run: () => openTab(HOME) },
      {
        key: 'cmd:sidebar',
        icon: '⌘',
        label: 'Toggle sidebar',
        run: () => setSidebar((v) => !v),
      },
      { key: 'cmd:log', icon: '⌘', label: 'Toggle log', run: () => setShowLog((v) => !v) },
      { key: 'cmd:capture', icon: '⌘', label: 'Capture page', run: () => void capture() },
      ...SPACES.map((sp) => ({
        key: `cmd:space:${sp.id}`,
        icon: '◧',
        label: `Go to ${sp.name}`,
        run: () => setSpaceId(sp.id),
      })),
    ].map((item) => ({
      ...item,
      run: () => {
        item.run()
        setCommand((c) => ({ ...c, open: false }))
      },
    }))

    return [
      ...items,
      ...fuzzyFilter(commandItems, q, (i) => i.label, 6),
      ...fuzzyFilter(tabItems, q, (i) => i.label, 8),
      // A web search is the fallback, so it sorts last.
      ...(q && !navigable ? [navigate(q)] : []),
    ]
    // `capture` is recreated per render but only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.value, command.newTab, tabs, go, openTab])

  const capture = async () => {
    if (!activeFrame) return
    setShowLog(true)
    const info = await activeFrame.probe()
    log(info ? `capture → ${JSON.stringify(info)}` : 'capture failed (no executeScript)')
  }

  const renderTab = (tab: Tab) => (
    <TabRow
      key={tab.id}
      label={tab.title}
      title={tab.url}
      active={tab.id === activeId}
      pinned={tab.pinned}
      onSelect={() => setActiveBySpace((m) => ({ ...m, [tab.spaceId]: tab.id }))}
      onTogglePin={() =>
        setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, pinned: !t.pinned } : t)))
      }
      onClose={() => closeTab(tab.id)}
    />
  )

  return (
    <div className={styles.shell} style={{ ['--hue' as string]: space.hue }}>
      {!controlledFrame.available && (
        <Banner tone="error" floating>
          {`<controlledframe> unavailable — ${controlledFrame.detail} · run: mise run iwa`}
        </Banner>
      )}

      <Sidebar open={sidebar} className={styles.sidebar}>
        <Toolbar>
          <IconButton title="toggle sidebar (⌘S)" onClick={() => setSidebar((s) => !s)}>
            ▏
          </IconButton>
          <IconButton disabled={!nav.back} title="back" onClick={() => activeFrame?.back()}>
            ‹
          </IconButton>
          <IconButton
            disabled={!nav.forward}
            title="forward"
            onClick={() => activeFrame?.forward()}
          >
            ›
          </IconButton>
          <IconButton title="reload" onClick={() => activeFrame?.reload()}>
            ⟳
          </IconButton>
          <Spacer />
          {offerUnframe && (
            <IconButton
              title="Remove the title bar — grants window management, then reopen the window"
              onClick={() => {
                void requestWindowManagement().then((ok) => {
                  log(ok ? 'window-management granted — reopen to go unframed' : 'permission denied')
                  setOfferUnframe(!ok)
                })
              }}
            >
              ⤢
            </IconButton>
          )}
          <IconButton title="capture page (archive test)" onClick={() => void capture()}>
            ⤓
          </IconButton>
        </Toolbar>

        <AddressPill
          value={active ? active.url.replace(/^https?:\/\//, '') : ''}
          title="edit address (⌘L)"
          onClick={() => setCommand({ open: true, value: active?.url ?? '', newTab: false })}
        />

        {pinned.length > 0 && (
          <>
            <SectionLabel>Pinned</SectionLabel>
            <div className={styles.tabList}>{pinned.map(renderTab)}</div>
          </>
        )}

        <SectionLabel>{space.name}</SectionLabel>
        <div className={styles.tabList}>
          {loose.map(renderTab)}
          <SidebarButton onClick={() => setCommand({ open: true, value: '', newTab: true })}>
            + New tab
          </SidebarButton>
        </div>

        <Spacer />

        <SpaceRail
          spaces={SPACES.map((s) => ({
            id: s.id,
            name: s.name,
            title: `${s.name} — separate container (${s.partition})`,
          }))}
          activeId={spaceId}
          onSelect={setSpaceId}
        />
      </Sidebar>

      <main className={styles.stage}>
        <div className={styles.card} ref={cardRef} />
      </main>

      <CommandPalette
        open={command.open}
        query={command.value}
        items={paletteItems}
        placeholder={
          command.newTab ? 'Search tabs, commands, or enter an address…' : 'Edit address…'
        }
        emptyLabel="type an address to navigate"
        onQueryChange={(value) => setCommand((c) => ({ ...c, value }))}
        onSubmit={(value) => {
          go(value, command.newTab)
          setCommand((c) => ({ ...c, open: false }))
        }}
        onDismiss={() => setCommand((c) => ({ ...c, open: false }))}
      />

      {showLog && (
        <LogPanel
          lines={lines.map((text) => ({
            text,
            tone: text.includes('blocked') ? ('ok' as const) : text.includes('MISSING') ? ('err' as const) : undefined,
          }))}
        />
      )}
    </div>
  )
}
