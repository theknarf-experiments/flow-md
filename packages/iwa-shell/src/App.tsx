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
  PinnedGrid,
  SectionLabel,
  Sidebar,
  SpaceRail,
  SidebarButton,
  SpaceHeader,
  Tab as TabRow,
  Toolbar,
  SwipeDeck,
  fuzzyFilter,
  useSwipeDeck,
} from '@flow-md/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import {
  controlledFrame,
  cspSelfTest,
  hasTitleBar,
  windowManagementState,
} from './lib/env.js'
import { type FrameHandle, createFrame, normalizeUrl } from './lib/frames.js'

const HOME = 'http://localhost:4748/'
/** Width to keep clear at the start of the toolbar row for the macOS traffic
 *  lights, which a frameless window draws over the top-left of our content.
 *  Hardcoded because Chrome exposes no metric for them — the same number
 *  Darc uses, less this sidebar's own padding. */
const TRAFFIC_LIGHTS = 76

interface Space {
  id: string
  name: string
  emoji: string
  /** Base hue for the gradient; each space feels distinct, as in Arc. */
  hue: number
  /** Guests are partitioned per space, so spaces are real containers:
   *  separate cookies, storage and logins. */
  partition: string
}

const INITIAL_SPACES: Space[] = [
  { id: 'vault', name: 'Vault', emoji: '📓', hue: 250, partition: 'persist:vault' },
  { id: 'web', name: 'Web', emoji: '🌐', hue: 190, partition: 'persist:web' },
  { id: 'scratch', name: 'Scratch', emoji: '🧪', hue: 320, partition: 'persist:scratch' },
]

interface Tab {
  id: number
  spaceId: string
  title: string
  url: string
  pinned: boolean
  /** Inlined favicon; null until the guest has fetched it. */
  icon: string | null
}

/** Emoji offered to new spaces, in order. */
const SPACE_EMOJI = ['🎨', '📚', '🎧', '🛠️', '🌱', '🔭']

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [spaces, setSpaces] = useState<Space[]>(INITIAL_SPACES)
  const [spaceId, setSpaceId] = useState(INITIAL_SPACES[0]!.id)
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
  /** Frameless window: macOS draws the traffic lights straight over our
   *  content, and env(titlebar-area-height) stays 0 because there's no
   *  window-controls overlay to report — so reserve the space ourselves.
   *  Measured after mount, not during: the window is still settling on the
   *  first render and outerHeight/innerHeight don't agree yet. */
  const [unframed, setUnframed] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const frames = useRef(new Map<number, FrameHandle>())
  const seq = useRef(0)
  /** Creating guests is an imperative side effect, and StrictMode invokes
   *  effects twice in dev — without this we boot two of every tab. */
  const booted = useRef(false)
  /** Tabs whose favicon we've already given a second chance. */
  const iconRetried = useRef(new Set<number>())

  const space = spaces.find((s) => s.id === spaceId) ?? spaces[0]!
  const activeId = activeBySpace[spaceId] ?? null
  const active = tabs.find((t) => t.id === activeId) ?? null
  const activeFrame = activeId !== null ? frames.current.get(activeId) : undefined

  const log = useCallback((msg: string) => setLines((l) => [msg, ...l].slice(0, 200)), [])


  /** Pull the guest's real title/url back out after it navigates. */
  const sync = useCallback(async (id: number) => {
    const frame = frames.current.get(id)
    if (!frame) return
    const info = await frame.probe()
    if (info) {
      setTabs((ts) =>
        ts.map((t) =>
          t.id === id
            ? { ...t, title: info.title || info.url, url: info.url, icon: info.icon ?? t.icon }
            : t,
        ),
      )
      // The guest fetches its favicon asynchronously and executeScript can't
      // await it, so look again shortly — once, not in a loop.
      if (!info.icon && !iconRetried.current.has(id)) {
        iconRetried.current.add(id)
        setTimeout(() => void sync(id), 900)
      }
    }
    setNav({ back: await frame.canGoBack(), forward: await frame.canGoForward() })
  }, [])

  const openTab = useCallback(
    (url: string, opts: { space?: string; pinned?: boolean; activate?: boolean } = {}) => {
      const container = cardRef.current
      if (!container) return
      const target = opts.space ?? spaceId
      const partition = (spaces.find((s) => s.id === target) ?? spaces[0]!).partition
      const id = ++seq.current
      const frame = createFrame(url, partition, container, styles.frameActive!, () => {
        void sync(id)
      })
      frames.current.set(id, frame)
      setTabs((ts) => [
        ...ts,
        { id, spaceId: target, title: url, url, pinned: !!opts.pinned, icon: null },
      ])
      if (opts.activate !== false) setActiveBySpace((m) => ({ ...m, [target]: id }))
      log(`tab ${id} → ${url}`)
    },
    [spaceId, spaces, log, sync],
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

  useEffect(() => {
    const check = () => setUnframed(!hasTitleBar())
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

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
      const space = spaces.find((sp) => sp.id === t.spaceId)
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
      ...spaces.map((sp) => ({
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
  }, [command.value, command.newTab, tabs, spaces, go, openTab])

  const addSpace = useCallback(() => {
    const id = `space-${spaces.length + 1}-${Math.random().toString(36).slice(2, 7)}`
    const next: Space = {
      id,
      name: `Space ${spaces.length + 1}`,
      emoji: SPACE_EMOJI[spaces.length % SPACE_EMOJI.length] ?? '•',
      // Spread the hues so a new space is visibly its own place.
      hue: (spaces.length * 67 + 250) % 360,
      partition: `persist:${id}`,
    }
    setSpaces((s) => [...s, next])
    setSpaceId(id)
    // A brand-new space with no tabs would render a blank card.
    openTab(HOME, { space: id })
    log(`space ${next.name} (${next.partition})`)
  }, [spaces, openTab, log])

  /** Swipe anywhere over the sidebar to slide between spaces. The deck stops
   *  at either end rather than wrapping — there is no space past the last one. */
  const spaceIndex = Math.max(
    0,
    spaces.findIndex((s) => s.id === spaceId),
  )
  const swipe = useSwipeDeck(sidebarRef, {
    count: spaces.length,
    index: spaceIndex,
    onIndex: (i) => {
      const next = spaces[i]
      if (next) setSpaceId(next.id)
    },
  })

  const capture = async () => {
    if (!activeFrame) return
    setShowLog(true)
    const info = await activeFrame.probe()
    log(info ? `capture → ${JSON.stringify(info)}` : 'capture failed (no executeScript)')
  }

  const renderTab = (tab: Tab, activeInSpace: number | null) => (
    <TabRow
      key={tab.id}
      label={tab.title}
      icon={tab.icon}
      title={tab.url}
      active={tab.id === activeInSpace}
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

      <Sidebar open={sidebar} className={styles.sidebar} ref={sidebarRef}>
        <Toolbar leadingInset={unframed ? TRAFFIC_LIGHTS : 0}>
          <IconButton tooltip="Hide sidebar  ⌘S" onClick={() => setSidebar((v) => !v)}>
            ▏
          </IconButton>
          <IconButton tooltip="Back" disabled={!nav.back} onClick={() => activeFrame?.back()}>
            ‹
          </IconButton>
          <IconButton
            tooltip="Forward"
            disabled={!nav.forward}
            onClick={() => activeFrame?.forward()}
          >
            ›
          </IconButton>
          <IconButton tooltip="Reload" onClick={() => activeFrame?.reload()}>
            ⟳
          </IconButton>
        </Toolbar>

        <AddressPill
          value={active ? active.url.replace(/^https?:\/\//, '') : ''}
          title="edit address (⌘L)"
          onClick={() => setCommand({ open: true, value: active?.url ?? '', newTab: false })}
        />

        {/* Every space's tabs are laid out side by side, so a swipe carries
            the one you're leaving off-screen as the next arrives. */}
        <SwipeDeck
          index={spaceIndex}
          offset={swipe.offset}
          dragging={swipe.dragging}
          className={styles.deck}
        >
          {spaces.map((sp) => {
            const spaceTabs = tabs.filter((t) => t.spaceId === sp.id)
            const spacePinned = spaceTabs.filter((t) => t.pinned)
            const spaceActive = activeBySpace[sp.id] ?? null
            return (
              <div className={styles.panel} key={sp.id}>
                {spacePinned.length > 0 && (
                  <PinnedGrid
                    items={spacePinned.map((t) => ({
                      id: t.id,
                      label: t.title,
                      icon: t.icon,
                      title: t.url,
                    }))}
                    activeId={spaceActive}
                    onSelect={(id) => setActiveBySpace((m) => ({ ...m, [sp.id]: Number(id) }))}
                    onUnpin={(id) =>
                      setTabs((ts) =>
                        ts.map((t) => (t.id === Number(id) ? { ...t, pinned: false } : t)),
                      )
                    }
                  />
                )}

                <SpaceHeader emoji={sp.emoji}>{sp.name}</SpaceHeader>
                <div className={styles.tabList}>
                  {spaceTabs.filter((t) => !t.pinned).map((t) => renderTab(t, spaceActive))}
                  <SidebarButton
                    onClick={() => {
                      setSpaceId(sp.id)
                      setCommand({ open: true, value: '', newTab: true })
                    }}
                  >
                    + New tab
                  </SidebarButton>
                </div>
              </div>
            )
          })}
        </SwipeDeck>

        <SpaceRail
          spaces={spaces.map((s) => ({
            id: s.id,
            name: s.name,
            emoji: s.emoji,
            title: `${s.name} — separate container (${s.partition})`,
          }))}
          activeId={spaceId}
          onSelect={setSpaceId}
          onAddSpace={addSpace}
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
