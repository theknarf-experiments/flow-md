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
  ChevronLeftIcon,
  ChevronRightIcon,
  ContextMenu,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  EmojiPicker,
  HueSwatches,
  IconButton,
  LogPanel,
  Placeholder,
  PinnedGrid,
  SectionLabel,
  Sidebar,
  ReloadIcon,
  SidebarIcon,
  Sheet,
  SheetSection,
  ShortcutList,
  SpaceRail,
  SidebarButton,
  SpaceHeader,
  Tab as TabRow,
  Toolbar,
  SwipeDeck,
  fuzzyFilter,
  useContextMenu,
  useReorder,
} from '@flow-md/ui'
import {
  formatForDisplay,
  getHotkeyManager,
  getSequenceManager,
  useHotkey,
  useHotkeySequence,
} from '@tanstack/react-hotkeys'
import { useLiveQuery } from '@tanstack/react-db'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import {
  controlledFrame,
  cspSelfTest,
  hasTitleBar,
  windowManagementState,
} from './lib/env.js'
import { type FrameHandle, type KeyClaim, createFrame, normalizeUrl } from './lib/frames.js'
import {
  type Space,
  type Tab as Row,
  addLink,
  moveLink,
  setDepth,
  spacesCollection,
  tabsCollection,
  lastClosed,
  record,
} from './lib/db.js'
import { type Status, vault } from './lib/vault.js'

const HOME = 'http://localhost:4748/'
/** Width to keep clear at the start of the toolbar row for the macOS traffic
 *  lights, which a frameless window draws over the top-left of our content.
 *  Hardcoded because Chrome exposes no metric for them — the same number
 *  Darc uses, less this sidebar's own padding. */
declare module '@tanstack/hotkeys' {
  interface HotkeyMeta {
    /** Groups the binding in the shortcut sheet. */
    category?: string
  }
}

/** The recess drawn behind the traffic lights.
 *
 *  No web API will say where they are, but macOS itself will — the
 *  Accessibility API reports their frames, and against this window's origin
 *  the three buttons come out at x 19/39/59, 16px square, y −1. So the
 *  circles they draw span x 21–73 and y 1–13.
 *
 *  Hence 11px of clearance either side. Above them there is none to give:
 *  the well hangs from the window's top edge and macOS parks the lights 1px
 *  below it, so the well is bottom-heavy by construction. The toolbar starts
 *  where the well ends. */
const TRAFFIC_WELL = { left: 10, width: 74 }

/** What the browser knows about a tab that the file doesn't: its favicon.
 *  Everything else — which tabs exist, where they point, what they're
 *  called, whether they're pinned — is a row. */
interface Runtime {
  icon?: string | null
}

/** Emoji offered to new spaces, in order, and in the space menu. */
const SPACE_EMOJI = ['📓', '🌐', '🧪', '🎨', '📚', '🎧', '🛠️', '🌱', '🔭', '💼', '🎮', '📮']

/** The colours a space can be recoloured to — spread right round the wheel so
 *  no two are easy to confuse at a glance. */
const HUES = [250, 285, 320, 355, 25, 90, 155, 190]

/** Mac binds Mod to ⌘ and everything else to Ctrl — the same rule TanStack
 *  displays by, resolved here because the shell knows the platform and a
 *  guest shouldn't have to. */
const MOD: 'meta' | 'ctrl' = /mac|iphone|ipad/i.test(navigator.platform) ? 'meta' : 'ctrl'

/** One binding string — "Mod+T", "Shift+G", "J" — as a claim. */
function parseClaim(hotkey: string): KeyClaim | null {
  const parts = hotkey
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  const key = parts.pop()?.toLowerCase()
  if (!key) return null
  const claim: KeyClaim = { key }
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'mod':
        claim[MOD] = true
        break
      case 'meta':
      case 'cmd':
      case 'command':
        claim.meta = true
        break
      case 'ctrl':
      case 'control':
        claim.ctrl = true
        break
      case 'alt':
      case 'option':
        claim.alt = true
        break
      case 'shift':
        claim.shift = true
        break
    }
  }
  return claim
}

/** Every documented binding, in the form guests match keydowns against.
 *
 *  Read as a snapshot and never subscribed to: useHotkey writes its options
 *  back into the manager during render, so anything watching this re-renders
 *  itself forever. Named bindings only — an undocumented one like Escape is
 *  left to the page, which has its own uses for it. */
function hotkeyClaims(): KeyClaim[] {
  const named = (r: { options?: { meta?: { name?: string } } }) => !!r.options?.meta?.name
  const chords = [...getHotkeyManager().registrations.state.values()]
    .filter(named)
    .map((r) => r.hotkey)
  const steps = [...getSequenceManager().registrations.state.values()]
    .filter(named)
    .flatMap((r) => r.sequence)
  return [...new Set([...chords, ...steps])]
    .map(parseClaim)
    .filter((c): c is KeyClaim => !!c)
}

export function App() {
  // The vault's rows *are* the state. A link added in an editor is a row that
  // appears; a row that appears is a tab that opens. TanStack DB does the
  // syncing — polling, optimistic writes, rollback — so nothing here tracks
  // what it already knows.
  const { data: spaceRows } = useLiveQuery((q) => q.from({ space: spacesCollection }))
  const { data: tabRows } = useLiveQuery((q) => q.from({ tab: tabsCollection }))

  // A collection is a keyed map; a rail and a tab list are ordered.
  const spaces = useMemo(
    () =>
      [...(spaceRows as Space[])].sort(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name),
      ),
    [spaceRows],
  )
  const tabs = useMemo(
    () => [...(tabRows as Row[])].sort((a, b) => a.line - b.line),
    [tabRows],
  )

  const [runtime, setRuntime] = useState<Record<string, Runtime>>({})
  /** Whether the vault answers. The collections poll it anyway; this is the
   *  same question asked on the window's behalf, so it has something to say
   *  when they come back with nothing. */
  const [status, setStatus] = useState<Status>('connecting')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingTab, setRenamingTab] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const spaceMenu = useContextMenu<string>()
  const tabMenu = useContextMenu<string>()
  const [spaceId, setSpaceId] = useState('')
  /** Active tab per space, so switching spaces restores where you were. */
  const [activeBySpace, setActiveBySpace] = useState<Record<string, string | null>>({})
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
  const shellRef = useRef<HTMLDivElement>(null)
  /** One guest per row, keyed the same way the rows are. */
  const frames = useRef(new Map<string, FrameHandle>())
  /** Tabs whose favicon we've already given a second chance. */
  const iconRetried = useRef(new Set<string>())

  const space = spaces.find((s) => s.id === spaceId) ?? spaces[0]
  const spaceTabs = tabs.filter((t) => t.space === space?.id)
  const activeId = activeBySpace[spaceId] ?? spaceTabs[0]?.id ?? null
  const active = tabs.find((t) => t.id === activeId) ?? null
  const activeFrame = activeId ? frames.current.get(activeId) : undefined

  const log = useCallback((msg: string) => setLines((l) => [msg, ...l].slice(0, 200)), [])

  /** Read the guest and write down what it says: its favicon, whether it can
   *  go back, where it now is and what that page calls itself.
   *
   *  A tab that follows a link is a link that followed it — the document is
   *  the tab list, so the file has to say where the tab actually is. The
   *  label follows too, but only when the file isn't already saying something
   *  a person chose: a hand-written label survives until the tab is navigated
   *  away from what it named. */
  const sync = useCallback(async (id: string) => {
    const frame = frames.current.get(id)
    if (!frame) return
    void frame.adopt(hotkeyClaims())
    const info = await frame.probe()
    if (info) {
      setRuntime((r) => ({ ...r, [id]: { icon: info.icon ?? r[id]?.icon ?? null } }))
      const row = tabsCollection.get(id)
      const title = info.title || info.url
      if (row && row.url !== info.url) {
        // The tab went somewhere else, so the link does too, and it takes the
        // new page's name with it. A label somebody wrote in the markdown
        // named the page it pointed at; once the tab has left, it doesn't.
        tabsCollection.update(id, (draft) => {
          draft.url = info.url
          draft.title = title
        })
      } else if (row && row.title === row.url && row.title !== title) {
        // A label the browser wrote, now that the page has said its name. A
        // label somebody typed into the markdown never matches its own url,
        // so it is left alone.
        tabsCollection.update(id, (draft) => {
          draft.title = title
        })
      }
      // The guest fetches its favicon asynchronously and executeScript can't
      // await it, so look again shortly — once, not in a loop.
      if (!info.icon && !iconRetried.current.has(id)) {
        iconRetried.current.add(id)
        setTimeout(() => void sync(id), 900)
      }
    }
    setNav({ back: await frame.canGoBack(), forward: await frame.canGoForward() })
  }, [])

  /** Opening a tab is writing a link. The row comes back from the vault a
   *  round trip later and the effect above gives it a guest — including when
   *  the same page is already open, because a second link is a second row. */
  const openTab = useCallback(
    (url: string, opts: { space?: string; activate?: boolean; under?: Row } = {}) => {
      const target = opts.space ?? spaceId
      if (!target) return
      void addLink(target, url, url, opts.under).then(() => {
        void record('opened', { url, title: url, space: target })
        if (opts.activate === false) return
        const opened = tabsCollection.toArray
          .filter((t) => t.space === target && t.url === url)
          .sort((a, b) => a.start - b.start)
          .pop()
        if (opened) setActiveBySpace((m) => ({ ...m, [target]: opened.id }))
      })
      log(`tab → ${url}`)
    },
    [spaceId, log],
  )

  const closeTab = useCallback(
    (id: string) => {
      const victim = tabsCollection.get(id)
      if (!victim) return
      const siblings = tabsCollection.toArray.filter(
        (t) => t.space === victim.space && t.id !== id,
      )
      setActiveBySpace((m) =>
        m[victim.space] === id
          ? { ...m, [victim.space]: siblings[siblings.length - 1]?.id ?? null }
          : m,
      )
      tabsCollection.delete(id)
      void record('closed', { url: victim.url, title: victim.title, space: victim.space })
      log(`closed ${victim.url}`)
    },
    [log],
  )

  /** ⌘⇧T: the history says where a closed tab was, so putting it back is the
   *  same as opening it — the link goes into the space it was closed from,
   *  which may not be the space showing now. */
  const reopenLast = useCallback(async () => {
    const gone = await lastClosed()
    if (!gone) {
      log('nothing closed to reopen')
      return
    }
    openTab(gone.url, { space: gone.space || spaceId })
  }, [openTab, spaceId, log])

  /** Rows in, guests out. The only place the document and the browser meet:
   *  every row gets a frame, every frame without a row is destroyed. There is
   *  nothing to reconcile because there is nothing else keeping score. */
  useEffect(() => {
    const container = cardRef.current
    if (!container) return
    const wanted = new Map(tabs.map((t) => [t.id, t]))

    for (const [id, row] of wanted) {
      if (frames.current.has(id)) continue
      const owner = spaces.find((s) => s.id === row.space)
      if (!owner) continue
      const frame = createFrame(
        row.url,
        owner.partition,
        container,
        styles.frameActive!,
        () => void sync(id),
        // A link opened in a new tab is a link written into the space, the
        // same as any other — so ⌘-click adds a line to the file, indented
        // under the tab it was opened from.
        (target) =>
          openTab(target, {
            space: row.space,
            activate: false,
            under: tabsCollection.get(id),
          }),
      )
      frames.current.set(id, frame)
    }

    for (const [id, frame] of frames.current) {
      if (wanted.has(id)) continue
      frame.destroy()
      frames.current.delete(id)
      iconRetried.current.delete(id)
    }
  }, [tabs, spaces, sync, openTab])

  useEffect(() => {
    const check = () => setUnframed(!hasTitleBar())
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    const check = () => setStatus(vault.status())
    check()
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [])

  // Boot: say what the environment is, and let the collections do the rest.
  // They started polling the moment they were created.
  useEffect(() => {
    for (const line of cspSelfTest()) log(line)
    log(
      controlledFrame.available
        ? `controlledframe: ${controlledFrame.detail}`
        : `controlledframe MISSING — ${controlledFrame.detail}`,
    )
    void windowManagementState().then((state) => {
      log(`window-management: ${state} · title bar: ${hasTitleBar()}`)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Follow the vault when it names a space we aren't showing — at startup,
   *  or when the one we were in is deleted from under us. */
  useEffect(() => {
    if (spaces.length === 0) return
    setSpaceId((current) =>
      spaces.some((s) => s.id === current) ? current : (spaces[0]?.id ?? ''),
    )
  }, [spaces])

  // Only the active tab of the active space is visible.
  useEffect(() => {
    for (const [id, frame] of frames.current) frame.setActive(id === activeId)
    if (activeId !== null) void sync(activeId)
  }, [activeId, tabs.length, sync])

  const go = useCallback(
    (value: string, asNewTab: boolean) => {
      const url = normalizeUrl(value, HOME)
      if (asNewTab || !activeFrame || !activeId) {
        openTab(url)
      } else {
        // Navigating an open tab moves the guest, not the link: the file says
        // where the tab started, and that's what makes it a bookmark.
        activeFrame.navigate(url)
        log(`navigate → ${url}`)
      }
    },
    [activeFrame, activeId, openTab, log],
  )

  /** Move the selection through the current space's tabs, in the order the
   *  sidebar shows them. */
  const stepTab = useCallback(
    (delta: number) => {
      const inSpace = tabs.filter((t) => t.space === spaceId)
      const order = [...inSpace.filter((t) => t.pinned), ...inSpace.filter((t) => !t.pinned)]
      if (order.length === 0) return
      const i = order.findIndex((t) => t.id === activeId)
      // From nowhere, j lands on the first tab and k on the last.
      const next = order[i < 0 ? (delta > 0 ? 0 : order.length - 1) : (i + delta + order.length) % order.length]
      if (next) setActiveBySpace((m) => ({ ...m, [spaceId]: next.id }))
    },
    [tabs, spaceId, activeId],
  )

  /** Keys a guest handed back — replayed as ordinary keydowns so they go
   *  through the same registrations as keys pressed against the chrome. The
   *  guest has already decided these aren't meant for the page. */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as {
        flowmd?: string
        key?: string
        code?: string
        shiftKey?: boolean
        ctrlKey?: boolean
        metaKey?: boolean
        altKey?: boolean
      }
      if (data?.flowmd !== 'key' || !data.key) return
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: data.key,
          code: data.code ?? '',
          // Every modifier, or a chord arrives as its bare key and fires the
          // wrong binding — ⌃J would read as plain j and scroll the page.
          shiftKey: !!data.shiftKey,
          ctrlKey: !!data.ctrlKey,
          metaKey: !!data.metaKey,
          altKey: !!data.altKey,
          bubbles: true,
        }),
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  /** Clamped, not wrapping — the same rule the swipe follows, so ⌃H at the
   *  first space does nothing rather than teleporting to the last. */
  const stepSpace = useCallback(
    (delta: number) => {
      const i = spaces.findIndex((sp) => sp.id === spaceId)
      const next = spaces[Math.min(spaces.length - 1, Math.max(0, i + delta))]
      if (next) setSpaceId(next.id)
    },
    [spaces, spaceId],
  )

  /** Chords the shell owns. Anything vim-ish is deliberately bare-key and so
   *  only fires while the chrome has focus — once you click into a page, its
   *  own keystrokes are its business, and a guest is a separate process that
   *  never reports them back. */
  const vim = (name: string) => ({ enabled: !command.open, meta: { name, category: 'Page' } })
  const tabs_ = (name: string) => ({ meta: { name, category: 'Tabs & spaces' } })
  const win = (name: string) => ({ meta: { name, category: 'Window' } })

  useHotkey('Mod+T', () => setCommand({ open: true, value: '', newTab: true }), tabs_('New tab'))
  useHotkey(
    'Mod+L',
    () => setCommand({ open: true, value: active?.url ?? '', newTab: false }),
    win('Edit address'),
  )
  useHotkey('Mod+S', () => setSidebar((v) => !v), win('Show or hide the sidebar'))
  useHotkey(
    'Mod+W',
    () => {
      if (activeId !== null) closeTab(activeId)
    },
    tabs_('Close tab'),
  )
  useHotkey('Mod+,', () => setSettings(true), win('Settings'))
  useHotkey('Escape', () => setCommand((c) => ({ ...c, open: false })))

  useHotkey('Control+J', () => stepTab(1), tabs_('Next tab'))
  useHotkey('Control+K', () => stepTab(-1), tabs_('Previous tab'))
  useHotkey('Control+H', () => stepSpace(-1), tabs_('Space to the left'))
  useHotkey('Control+L', () => stepSpace(1), tabs_('Space to the right'))

  useHotkey('J', () => activeFrame?.scrollBy(120), vim('Scroll down'))
  useHotkey('K', () => activeFrame?.scrollBy(-120), vim('Scroll up'))
  useHotkey('Shift+G', () => activeFrame?.scrollToEdge('end'), vim('Jump to the end'))
  useHotkeySequence(['G', 'G'], () => activeFrame?.scrollToEdge('top'), vim('Jump to the top'))
  useHotkey('Shift+H', () => activeFrame?.back(), vim('Back'))
  useHotkey('Shift+L', () => activeFrame?.forward(), vim('Forward'))
  useHotkey('Mod+Shift+T', () => void reopenLast(), tabs_('Reopen the last closed tab'))
  useHotkey('F', () => void activeFrame?.hint(false), vim('Hint a link'))
  useHotkey('Shift+F', () => void activeFrame?.hint(true), vim('Hint a link into a new tab'))

  /** The cheatsheet reads the hotkey manager rather than a table written
   *  alongside it: a binding that changes, or one someone forgets to
   *  document, can't drift out of sync with what's actually registered.
   *
   *  Read as a snapshot when the sheet opens, not subscribed to. useHotkey
   *  re-syncs its options into the manager's store during every render, so a
   *  component that both registers hotkeys and subscribes to the registry
   *  re-renders itself forever — this froze the whole window. Nothing
   *  registers or unregisters while the sheet is open anyway. */
  const shortcuts = useMemo(() => {
    if (!settings) return []
    const chips = (hotkey: string) => formatForDisplay(hotkey).split(' ').filter(Boolean)
    const named = (meta?: { name?: string }) => !!meta?.name
    const hotkeys = [...getHotkeyManager().registrations.state.values()]
      .filter((r) => named(r.options.meta))
      .map((r) => ({
        name: r.options.meta!.name!,
        category: r.options.meta!.category,
        keys: chips(r.hotkey),
      }))
    const sequences = [...getSequenceManager().registrations.state.values()]
      .filter((r) => named(r.options.meta))
      .map((r) => ({
        name: r.options.meta!.name!,
        category: r.options.meta!.category,
        keys: r.sequence.map((step) => chips(step).join('')),
        sequence: true,
      }))
    return [...hotkeys, ...sequences].sort((a, b) =>
      (a.category ?? '').localeCompare(b.category ?? ''),
    )
  }, [settings])

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
      const space = spaces.find((sp) => sp.id === t.space)
      return {
        key: `tab:${t.id}`,
        icon: '▤',
        label: t.title,
        detail: space?.name,
        run: () => {
          setSpaceId(t.space)
          setActiveBySpace((m) => ({ ...m, [t.space]: t.id }))
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
      { key: 'cmd:settings', icon: '⌘', label: 'Settings', run: () => setSettings(true) },
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

  /** Creating a space creates a file. The vault owns File as a system
   *  relation, so inserting one writes it to disk; the frontmatter that makes
   *  it a space follows. */
  const addSpace = useCallback(() => {
    const n = spaces.length + 1
    const name = `Space ${n}`
    const emoji = SPACE_EMOJI[(n + 2) % SPACE_EMOJI.length] ?? '•'
    // Spread the hues so a new space is visibly its own place.
    const hue = (spaces.length * 67 + 250) % 360
    const id = `spaces/space-${n}-${Math.random().toString(36).slice(2, 7)}.md`

    spacesCollection.insert({
      id,
      name,
      emoji,
      hue,
      pinned: [],
      partition: `persist:${id.replace(/[^\w]/g, '-')}`,
      // New spaces go at the end of the rail.
      order: spaces.length + 1,
    })
    setSpaceId(id)
    log(`space ${name} → ${id}`)
  }, [spaces, log])

  /** A space's metadata lives in its frontmatter, so each of these is a YAML
   *  edit. The collection applies it locally at once and posts it; if the
   *  write fails it rolls back on its own. */
  const editSpace = useCallback((id: string, key: 'name' | 'emoji' | 'hue', value: string | number) => {
    spacesCollection.update(id, (draft) => {
      Object.assign(draft, { [key]: value })
    })
  }, [])

  const renameSpace = useCallback(
    (id: string, name: string) => {
      editSpace(id, 'name', name)
      setRenaming(null)
    },
    [editSpace],
  )

  const recolourSpace = useCallback(
    (id: string, hue: number) => editSpace(id, 'hue', hue),
    [editSpace],
  )

  const reiconSpace = useCallback(
    (id: string, emoji: string) => editSpace(id, 'emoji', emoji),
    [editSpace],
  )

  /** Deleting a space deletes the file it is. Its tabs are lines in that
   *  file, so they go with it — nothing here has to close them. */
  const deleteSpace = useCallback(
    (id: string) => {
      if (spaces.length < 2) return
      const i = spaces.findIndex((s) => s.id === id)
      const remaining = spaces.filter((s) => s.id !== id)
      setSpaceId((current) =>
        current === id ? (remaining[i] ?? remaining[remaining.length - 1])?.id ?? '' : current,
      )
      spacesCollection.delete(id)
      log(`space ${id} deleted`)
    },
    [spaces, log],
  )

  const renameTab = useCallback((id: string, title: string) => {
    tabsCollection.update(id, (draft) => {
      draft.title = title
    })
    setRenamingTab(null)
  }, [])

  /** The async Clipboard API is the right one, but an IWA's permissions
   *  policy comes from its manifest and is resolved at *install* time — so
   *  every copy in an app installed before `clipboard-write` was declared
   *  fails with NotAllowedError. execCommand is deprecated and isn't gated by
   *  permissions policy, which makes it the fallback that actually works. */
  const copyUrl = useCallback(
    (url: string) => {
      const viaSelection = () => {
        const field = document.createElement('textarea')
        field.value = url
        field.setAttribute('aria-hidden', 'true')
        // Off-screen but focusable — a display:none field can't be selected.
        field.style.cssText = 'position:fixed;top:-100px;opacity:0'
        document.body.append(field)
        field.select()
        const copied = document.execCommand('copy')
        field.remove()
        log(copied ? `copied ${url}` : `copy failed`)
      }
      navigator.clipboard.writeText(url).then(() => log(`copied ${url}`), viaSelection)
    },
    [log],
  )

  /** A guest's partition is fixed when it's created, so moving a tab between
   *  spaces means rebuilding it in the other one. The page reloads; there's no
   *  way to carry a live document across a partition boundary. */
  const moveTab = useCallback(
    (id: string, target: string) => {
      const tab = tabsCollection.get(id)
      if (!tab || tab.space === target) return
      // Two edits to two files: the link leaves one and joins the other.
      tabsCollection.delete(id)
      void addLink(target, tab.url, tab.title)
      log(`tab → ${target}`)
    },
    [log],
  )

  /** Swipe over the sidebar to slide between spaces; <SwipeDeck> does the
   *  gesture. It stops at either end rather than wrapping — there is no space
   *  past the last one. */
  const spaceIndex = Math.max(
    0,
    spaces.findIndex((s) => s.id === spaceId),
  )

  /** The window's tint and the rail's indicator follow the swipe rather than
   *  waiting for it to commit: drag halfway towards the next space and you're
   *  halfway to its colour, with the indicator halfway between the two dots,
   *  so you can see where you're going and back out of it.
   *
   *  Written straight to the DOM — this runs on every scroll frame, and these
   *  are two custom properties, not state anything renders from. */
  const follow = useCallback(
    (position: number) => {
      const from = spaces[Math.min(Math.floor(position), spaces.length - 1)]
      const to = spaces[Math.min(Math.floor(position) + 1, spaces.length - 1)]
      if (!from || !to) return
      // Round the short way, so 350° to 10° passes through 0 rather than
      // sweeping back through every other colour.
      const delta = (((to.hue - from.hue + 540) % 360) - 180) * (position - Math.floor(position))
      shellRef.current?.style.setProperty('--hue', String(from.hue + delta))
      shellRef.current?.style.setProperty('--space-position', String(position))
    },
    [spaces],
  )

  // Switching space by any other route — the palette, a new space — still has
  // to land on the right tint.
  useEffect(() => {
    if (!space) return
    shellRef.current?.style.setProperty('--hue', String(space.hue))
    shellRef.current?.style.setProperty('--space-position', String(spaceIndex))
  }, [space, spaceIndex])

  const capture = async () => {
    if (!activeFrame) return
    setShowLog(true)
    const info = await activeFrame.probe()
    log(info ? `capture → ${JSON.stringify(info)}` : 'capture failed (no executeScript)')
  }

  /** Pinning is a url in the space's frontmatter, so it's an edit to the
   *  space rather than to the tab. */
  const togglePin = (tab: Row) => {
    const owner = spaces.find((s) => s.id === tab.space)
    if (!owner) return
    spacesCollection.update(owner.id, (draft) => {
      draft.pinned = tab.pinned
        ? draft.pinned.filter((u) => u !== tab.url)
        : [...draft.pinned, tab.url]
    })
  }

  /** Nothing to show in the card: either the vault can't be reached, or it
   *  can and has no spaces in it. */
  const nothingLoaded = status === 'offline' || (status === 'connected' && spaces.length === 0)

  /** Dragging a tab moves its link in the file, which is what puts the tabs
   *  in that order in the first place. */
  const reorder = useReorder<string>(
    (id, { before, depth }) => {
      const moved = tabsCollection.get(id)
      if (!moved) return
      // The list is every space's tabs end to end, so the row after the last
      // one of a space belongs to the next space. Landing before *that* would
      // mean writing into another file at a line that isn't there — so past
      // the end of its own space means last.
      const target = before ? tabsCollection.get(before) : undefined
      const sibling = target?.space === moved.space ? target : null
      // Same place, different level: that's an indent, not a move.
      if (!sibling && moved.id === tabs.filter((t) => t.space === moved.space).at(-1)?.id) {
        void setDepth(moved, depth)
        return
      }
      void moveLink(moved, sibling, depth)
    },
    tabs.map((t) => t.id),
    { depthOf: (id) => tabsCollection.get(id)?.depth ?? 0 },
  )

  const renderTab = (tab: Row, activeInSpace: string | null) => (
    <TabRow
      key={tab.id}
      label={tab.title}
      icon={runtime[tab.id]?.icon ?? null}
      title={tab.url}
      active={tab.id === activeInSpace}
      onContextMenu={(e) => tabMenu.open(e, tab.id)}
      editing={renamingTab === tab.id}
      onRename={(title) => renameTab(tab.id, title)}
      onCancelRename={() => setRenamingTab(null)}
      pinned={tab.pinned}
      onSelect={() => setActiveBySpace((m) => ({ ...m, [tab.space]: tab.id }))}
      onTogglePin={() => togglePin(tab)}
      onClose={() => closeTab(tab.id)}
      depth={tab.depth}
      drag={reorder.row(tab.id)}
    />
  )

  return (
    <div className={`${styles.shell} ${sidebar ? '' : styles.sidebarHidden}`} ref={shellRef}>
      {!controlledFrame.available && (
        <Banner tone="error" floating>
          {`<controlledframe> unavailable — ${controlledFrame.detail} · run: mise run iwa`}
        </Banner>
      )}

      {/* The traffic lights are drawn by macOS at a fixed spot and can't be
          moved or hidden, so the chrome is built around them: a recess under
          them turns an unavoidable gap into somewhere they sit. */}
      {unframed && (
        <div
          className={styles.trafficWell}
          style={{ left: TRAFFIC_WELL.left, width: TRAFFIC_WELL.width }}
        />
      )}

      <Sidebar open={sidebar} className={styles.sidebar}>
        <Toolbar leadingInset={unframed ? TRAFFIC_WELL.left + TRAFFIC_WELL.width : 0}>
          <IconButton size="lg" tooltip="Hide sidebar  ⌘S" onClick={() => setSidebar((v) => !v)}>
            <SidebarIcon />
          </IconButton>
          <IconButton
            size="lg"
            tooltip="Back"
            disabled={!nav.back}
            onClick={() => activeFrame?.back()}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            size="lg"
            tooltip="Forward"
            disabled={!nav.forward}
            onClick={() => activeFrame?.forward()}
          >
            <ChevronRightIcon />
          </IconButton>
          <IconButton size="lg" tooltip="Reload" onClick={() => activeFrame?.reload()}>
            <ReloadIcon />
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
          onIndexChange={(i) => {
            const next = spaces[i]
            if (next) setSpaceId(next.id)
          }}
          onProgress={follow}
          className={styles.deck}
        >
          {spaces.map((sp) => {
            const spaceTabs = tabs.filter((t) => t.space === sp.id)
            const spacePinned = spaceTabs.filter((t) => t.pinned)
            const spaceActive = activeBySpace[sp.id] ?? null
            return (
              <div className={styles.panel} key={sp.id}>
                {spacePinned.length > 0 && (
                  <PinnedGrid
                    items={spacePinned.map((t) => ({
                      id: t.id,
                      label: t.title,
                      icon: runtime[t.id]?.icon ?? null,
                      title: t.url,
                    }))}
                    activeId={spaceActive}
                    onSelect={(id) => setActiveBySpace((m) => ({ ...m, [sp.id]: String(id) }))}
                    onUnpin={(id) => {
                      const tab = tabsCollection.get(String(id))
                      if (tab) togglePin(tab)
                    }}
                  />
                )}

                <SpaceHeader
                  emoji={sp.emoji}
                  onContextMenu={(e) => spaceMenu.open(e, sp.id)}
                  editing={renaming === sp.id}
                  onRename={(name) => renameSpace(sp.id, name)}
                  onCancelRename={() => setRenaming(null)}
                >
                  {sp.name}
                </SpaceHeader>
                {/* Above the tabs rather than after them: a list that grows
                    downwards would otherwise walk the button off the bottom,
                    and it's the same reach every time up here. */}
                <div className={styles.newTabRow}>
                  <SidebarButton
                    className={styles.newTab}
                    onClick={() => {
                      setSpaceId(sp.id)
                      setCommand({ open: true, value: '', newTab: true })
                    }}
                  >
                    + New tab
                  </SidebarButton>
                </div>
                <div className={styles.tabList}>
                  {spaceTabs.filter((t) => !t.pinned).map((t) => renderTab(t, spaceActive))}
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

      {spaceMenu.anchor && (
        <ContextMenu x={spaceMenu.anchor.x} y={spaceMenu.anchor.y} onClose={spaceMenu.close}>
          <ContextMenuItem
            onSelect={() => {
              setRenaming(spaceMenu.anchor?.target ?? null)
              spaceMenu.close()
            }}
          >
            Rename space
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuLabel>Icon</ContextMenuLabel>
          <EmojiPicker
            choices={SPACE_EMOJI}
            value={spaces.find((s) => s.id === spaceMenu.anchor?.target)?.emoji}
            onSelect={(emoji) => reiconSpace(spaceMenu.anchor?.target ?? '', emoji)}
          />
          <ContextMenuSeparator />
          <ContextMenuLabel>Colour</ContextMenuLabel>
          <HueSwatches
            hues={HUES}
            value={spaces.find((s) => s.id === spaceMenu.anchor?.target)?.hue ?? HUES[0]!}
            // Left open on purpose: picking colours is a comparison, and
            // reopening the menu for each one makes that impossible.
            onSelect={(hue) => recolourSpace(spaceMenu.anchor?.target ?? '', hue)}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            danger
            disabled={spaces.length < 2}
            onSelect={() => {
              deleteSpace(spaceMenu.anchor?.target ?? '')
              spaceMenu.close()
            }}
          >
            Delete space
          </ContextMenuItem>
        </ContextMenu>
      )}

      {tabMenu.anchor && (
        <ContextMenu x={tabMenu.anchor.x} y={tabMenu.anchor.y} onClose={tabMenu.close}>
          <ContextMenuItem
            onSelect={() => {
              setRenamingTab(tabMenu.anchor?.target ?? null)
              tabMenu.close()
            }}
          >
            Rename tab
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const tab = tabs.find((t) => t.id === tabMenu.anchor?.target)
              if (tab) copyUrl(tab.url)
              tabMenu.close()
            }}
          >
            Copy URL
          </ContextMenuItem>
          {spaces.length > 1 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuLabel>Move to space</ContextMenuLabel>
              {spaces
                .filter((sp) => sp.id !== tabsCollection.get(tabMenu.anchor?.target ?? '')?.space)
                .map((sp) => (
                  <ContextMenuItem
                    key={sp.id}
                    onSelect={() => {
                      moveTab(tabMenu.anchor?.target ?? '', sp.id)
                      tabMenu.close()
                    }}
                  >
                    <span aria-hidden="true">{sp.emoji ?? '•'}</span>
                    {sp.name}
                  </ContextMenuItem>
                ))}
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            danger
            onSelect={() => {
              closeTab(tabMenu.anchor?.target ?? '')
              tabMenu.close()
            }}
          >
            Close tab
          </ContextMenuItem>
        </ContextMenu>
      )}

      <Sheet open={settings} title="Settings" onClose={() => setSettings(false)}>
        <SheetSection title="Keyboard shortcuts">
          <ShortcutList shortcuts={shortcuts} />
        </SheetSection>
      </Sheet>

      <main className={styles.stage}>
        <div
          className={`${styles.card} ${nothingLoaded ? styles.empty : ''}`}
          ref={cardRef}
        >
          {/* Guests are put in here imperatively and cover it when there are
              any; this is what's underneath when there aren't. */}
          {status === 'offline' && (
            <Placeholder
              icon="🔌"
              title="No vault"
              command="flow-md serve docs/"
            >
              This browser keeps its spaces in markdown files and reads them
              from a flow-md server. Start one over the folder you keep your
              notes in, and the window will fill itself in — nothing here needs
              restarting.
            </Placeholder>
          )}
          {status === 'connected' && spaces.length === 0 && (
            <Placeholder
              icon="📓"
              title="No spaces yet"
              action={{ label: 'Create one', onClick: addSpace }}
            >
              A space is a markdown file with <code>type: space</code> in its
              frontmatter. Its links are its tabs.
            </Placeholder>
          )}
        </div>
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
