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
import { type FrameHandle, createFrame, normalizeUrl } from './lib/frames.js'
import { type Space as VaultSpace, spacesCollection, tabsCollection } from './lib/db.js'
import { vault } from './lib/vault.js'

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

interface Space {
  /** The markdown file this space *is* — also its identity. */
  id: string
  name: string
  emoji: string
  /** Base hue for the gradient; each space feels distinct, as in Arc. */
  hue: number
  /** Guests are partitioned per space, so spaces are real containers:
   *  separate cookies, storage and logins. */
  partition: string
  /** Urls listed under `pinned:` in the file's frontmatter. */
  pinned: string[]
  /** Position in the rail — `order:` in the frontmatter. */
  order: number
}

/** What the shell shows before the vault answers, and what it falls back to
 *  when there isn't one — the browser still works without a vault, it just
 *  has nowhere to write its spaces down. */
const OFFLINE_SPACES: Space[] = [
  {
    id: '',
    name: 'Browser',
    emoji: '🌐',
    hue: 250,
    partition: 'persist:offline',
    pinned: [],
    order: 0,
  },
]

interface Tab {
  id: number
  spaceId: string
  title: string
  url: string
  pinned: boolean
  /** Set by "Rename tab" — stops the guest's own <title> overwriting it. */
  renamed?: boolean
  /** The url as the space's file spells it, which is what identifies the
   *  link to edit. The tab's own url moves with every redirect; this follows
   *  it deliberately, one write at a time. */
  vaultUrl?: string
  /** And what the file calls it. Kept so the two sides can tell whose change
   *  it was: if the page's title moved, write it down; if the file's label
   *  moved, the person editing the file meant it. */
  vaultText?: string
  /** Inlined favicon; null until the guest has fetched it. */
  icon: string | null
}

/** Emoji offered to new spaces, in order, and in the space menu. */
const SPACE_EMOJI = ['📓', '🌐', '🧪', '🎨', '📚', '🎧', '🛠️', '🌱', '🔭', '💼', '🎮', '📮']

/** The colours a space can be recoloured to — spread right round the wheel so
 *  no two are easy to confuse at a glance. */
const HUES = [250, 285, 320, 355, 25, 90, 155, 190]

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  // The vault's own rows. These *are* the state — a link deleted in an
  // editor is a row that vanishes here, and the browser follows.
  const { data: vaultSpaces } = useLiveQuery((q) => q.from({ space: spacesCollection }))
  const { data: vaultTabs } = useLiveQuery((q) => q.from({ tab: tabsCollection }))
  const [spaces, setSpaces] = useState<Space[]>(OFFLINE_SPACES)
  /** The same list, readable without waiting for a render. Boot loads the
   *  spaces and opens their tabs in one pass, and a tab needs its space's
   *  partition *now* — a guest's container is fixed when it's created, so
   *  reading a stale list would put every tab in the wrong one. */
  const spacesRef = useRef(spaces)
  spacesRef.current = spaces
  /** True once the vault has answered — writes are pointless before that. */
  const [backed, setBacked] = useState(false)
  /** The same, for callbacks that outlive a render: a guest's lifecycle
   *  handler is created once, when nothing is backed yet. */
  const backedRef = useRef(false)
  /** Tabs, readable from the reconcile loop without making it a dependency —
   *  it runs on a timer and would otherwise be torn down on every keystroke
   *  that changes a title. */
  const tabsRef = useRef<Tab[]>([])
  /** Which vault rows already have a guest, by space and url. */
  const openedRef = useRef(new Set<string>())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingTab, setRenamingTab] = useState<number | null>(null)
  const [settings, setSettings] = useState(false)
  const spaceMenu = useContextMenu<string>()
  const tabMenu = useContextMenu<number>()
  const [spaceId, setSpaceId] = useState(OFFLINE_SPACES[0]!.id)
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
  const shellRef = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<number, FrameHandle>())
  const seq = useRef(0)
  /** Creating guests is an imperative side effect, and StrictMode invokes
   *  effects twice in dev — without this we boot two of every tab. */
  const booted = useRef(false)
  /** Tabs whose favicon we've already given a second chance. */
  const iconRetried = useRef(new Set<number>())

  const space = spaces.find((s) => s.id === spaceId) ?? spaces[0]!
  tabsRef.current = tabs
  const activeId = activeBySpace[spaceId] ?? null
  const active = tabs.find((t) => t.id === activeId) ?? null
  const activeFrame = activeId !== null ? frames.current.get(activeId) : undefined

  const log = useCallback((msg: string) => setLines((l) => [msg, ...l].slice(0, 200)), [])


  /** Pull the guest's real title/url back out after it navigates. */
  const sync = useCallback(async (id: number) => {
    const frame = frames.current.get(id)
    if (!frame) return
    void frame.adopt()
    const info = await frame.probe()
    if (info) {
      // A tab that has gone somewhere else is a link that has gone somewhere
      // else. Rewriting it keeps the file a description of what's open rather
      // than of what was opened.
      setTabs((ts) => {
        const tab = ts.find((t) => t.id === id)
        if (tab?.vaultUrl && backedRef.current) {
          const from = tab.vaultUrl
          const title = info.title || info.url
          const movedTo = tab.vaultUrl === info.url ? null : info.url
          const renamedTo = tab.renamed || tab.vaultText === title ? null : title
          if (movedTo || renamedTo) {
            const row = tabsCollection.toArray.find((t) => t.space === tab.spaceId && t.url === from)
            if (row) {
              tabsCollection.update(row.id, (draft) => {
                if (movedTo) draft.url = movedTo
                if (renamedTo) draft.title = renamedTo
              })
            }
          }
        }
        return ts
      })
      setTabs((ts) =>
        ts.map((t) =>
          t.id === id
            ? {
                ...t,
                title: t.renamed ? t.title : info.title || info.url,
                url: info.url,
                icon: info.icon ?? t.icon,
                ...(t.vaultUrl
                  ? {
                      vaultUrl: info.url,
                      ...(t.renamed ? {} : { vaultText: info.title || info.url }),
                    }
                  : {}),
              }
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
    (
      url: string,
      opts: {
        space?: string
        pinned?: boolean
        activate?: boolean
        title?: string
        /** Already a line in the file — don't write it back again. */
        fromVault?: boolean
      } = {},
    ) => {
      const container = cardRef.current
      if (!container) return undefined
      const target = opts.space ?? spaceId
      const known = spacesRef.current
      const space = known.find((s) => s.id === target) ?? known[0]!
      const id = ++seq.current
      const frame = createFrame(url, space.partition, container, styles.frameActive!, () => {
        void sync(id)
      })
      frames.current.set(id, frame)
      const title = opts.title ?? url
      setTabs((ts) => [
        ...ts,
        {
          id,
          spaceId: target,
          title,
          url,
          pinned: !!opts.pinned,
          icon: null,
          ...(opts.title ? { renamed: true } : {}),
          ...(space.id ? { vaultUrl: url, vaultText: title } : {}),
        },
      ])
      if (opts.activate !== false) setActiveBySpace((m) => ({ ...m, [target]: id }))
      // Opening a tab writes a link into the space's file. That's the whole
      // trick: the tab list is the document.
      if (!opts.fromVault && backed && space.id) {
        // 0 is "append"; the vault reparses and the row comes back with its
        // real line, which is why this is an insert and not a local push.
        tabsCollection.insert({
          id: `${space.id}\n${url}`,
          space: space.id,
          url,
          title,
          line: 0,
          pinned: false,
        })
      }
      log(`tab ${id} → ${url}`)
      return id
    },
    [spaceId, spaces, backed, log, sync],
  )

  const closeTab = useCallback(
    (id: number, opts: { fromVault?: boolean } = {}) => {
      frames.current.get(id)?.destroy()
      frames.current.delete(id)
      setTabs((ts) => {
        const victim = ts.find((t) => t.id === id)
        const next = ts.filter((t) => t.id !== id)
        // Closing a tab takes its line out of the file. The line number is
        // whatever the file says now, so it's looked up rather than
        // remembered — the file may have been edited since.
        if (victim && backed && !opts.fromVault && victim.spaceId && victim.vaultUrl) {
          openedRef.current.delete(`${victim.spaceId}\n${victim.vaultUrl}`)
          const row = tabsCollection.toArray.find(
            (t) => t.space === victim.spaceId && t.url === victim.vaultUrl,
          )
          if (row) tabsCollection.delete(row.id)
        }
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
    [backed, log],
  )

  useEffect(() => {
    const check = () => setUnframed(!hasTitleBar())
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Boot: read the spaces out of the vault, and open every link each one
  // holds. Without a vault the shell still runs — one space, nothing written
  // down — so a browser is usable before a notebook exists.
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    for (const line of cspSelfTest()) log(line)
    log(
      controlledFrame.available
        ? `controlledframe: ${controlledFrame.detail}`
        : `controlledframe MISSING — ${controlledFrame.detail}`,
    )
    void (async () => {
      if (!(await vault.available())) {
        log('no vault — spaces are in memory only')
        openTab(HOME, { pinned: true })
        return
      }
      setBacked(true)
      backedRef.current = true
      log('vault: reading spaces')
      // Nothing else to do here: the collections are already polling, and
      // the effect below turns their rows into spaces and guests.
    })()
    void windowManagementState().then((state) => {
      log(`window-management: ${state} · title bar: ${hasTitleBar()}`)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The browser's own context menu offers nothing an app window can use —
   *  reload, back, view-source — and it covers ours. Suppressed everywhere
   *  except text fields, where cut/copy/paste is worth keeping. Guests draw
   *  their own menus inside their frames; this doesn't reach them. */
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', onMenu)
    return () => document.removeEventListener('contextmenu', onMenu)
  }, [])

  /** Turn the vault's rows into what the browser is showing.
   *
   *  This is the only place the two meet. The collections hold the data and
   *  poll for changes; guests are runtime objects that can't live in a
   *  database, so this creates one for every row that hasn't got one and
   *  destroys the ones whose row has gone. A link deleted in an editor
   *  closes a tab here for the same reason a link added in an editor opens
   *  one — neither is a special case, both are just rows.
   *
   *  It never writes. Everything it does is a consequence of what the vault
   *  already says. */
  useEffect(() => {
    if (!backed || vaultSpaces.length === 0) return

    // A collection is a keyed map; the rail is a row. Sorting here rather
    // than relying on the order rows arrived in.
    const ordered = [...(vaultSpaces as VaultSpace[])].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name),
    )
    spacesRef.current = ordered
    setSpaces((current) =>
      JSON.stringify(current) === JSON.stringify(ordered) ? current : ordered,
    )
    setSpaceId((current) =>
      ordered.some((s) => s.id === current) ? current : (ordered[0]?.id ?? current),
    )

    // A write of ours in flight means the rows are behind the browser, not
    // the other way round; acting on them would undo it.
    if (vault.busy()) return

    const open = tabsRef.current.filter((t) => t.vaultUrl)
    for (const row of vaultTabs) {
      const key = `${row.space}\n${row.url}`
      // Guests are created outside React, and this effect can run twice for
      // one change (StrictMode, or a second row arriving in the same tick).
      // The set is updated synchronously, before the state that would
      // otherwise be the only record.
      if (openedRef.current.has(key)) continue
      if (open.some((t) => t.spaceId === row.space && t.vaultUrl === row.url)) {
        openedRef.current.add(key)
        continue
      }
      openedRef.current.add(key)
      openTab(row.url, {
        space: row.space,
        title: row.title,
        pinned: row.pinned,
        activate: false,
        fromVault: true,
      })
    }
    for (const tab of open) {
      const row = vaultTabs.find((r) => r.space === tab.spaceId && r.url === tab.vaultUrl)
      if (!row) {
        openedRef.current.delete(`${tab.spaceId}\n${tab.vaultUrl}`)
        closeTab(tab.id, { fromVault: true })
        continue
      }
      // A label somebody rewrote in the file. Marked as renamed so the page's
      // own title doesn't immediately undo it.
      if (row.title !== tab.vaultText || row.pinned !== tab.pinned) {
        setTabs((ts) =>
          ts.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  pinned: row.pinned,
                  ...(row.title === tab.vaultText
                    ? {}
                    : { title: row.title, vaultText: row.title, renamed: true }),
                }
              : t,
          ),
        )
      }
    }
  }, [backed, vaultSpaces, vaultTabs, openTab, closeTab])

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

  /** Move the selection through the current space's tabs, in the order the
   *  sidebar shows them. */
  const stepTab = useCallback(
    (delta: number) => {
      const inSpace = tabs.filter((t) => t.spaceId === spaceId)
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
      const data = e.data as { flowmd?: string; key?: string; code?: string; shiftKey?: boolean }
      if (data?.flowmd !== 'key' || !data.key) return
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: data.key,
          code: data.code ?? '',
          shiftKey: !!data.shiftKey,
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

    if (!backed) {
      setSpaces((ss) => [
        ...ss,
        { id, name, emoji, hue, partition: `persist:${n}`, pinned: [], order: n },
      ])
      setSpaceId(id)
      openTab(HOME, { space: id })
      return
    }

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
  }, [spaces, backed, openTab, log])

  /** The space's own metadata lives in its frontmatter, so each of these is a
   *  YAML edit. The local state moves first — a rename shouldn't wait on a
   *  file write to show up. */
  const editSpace = useCallback(
    (id: string, key: 'name' | 'emoji' | 'hue', value: string | number) => {
      // Locally first so the rename shows at once, then through the
      // collection, which posts the frontmatter edit and refetches. When
      // there's no vault the local change is all there is.
      setSpaces((ss) => ss.map((s) => (s.id === id ? { ...s, [key]: value } : s)))
      if (!backed) return
      spacesCollection.update(id, (draft) => {
        Object.assign(draft, { [key]: value })
      })
    },
    [spaces, backed, log],
  )

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

  /** Deleting a space takes its tabs with it — they live nowhere else, and
   *  their guests would otherwise stay loaded and invisible. */
  const deleteSpace = useCallback(
    (id: string) => {
      setSpaces((ss) => {
        if (ss.length < 2) return ss
        const remaining = ss.filter((s) => s.id !== id)
        setSpaceId((current) => {
          if (current !== id) return current
          const i = ss.findIndex((s) => s.id === id)
          return (remaining[i] ?? remaining[remaining.length - 1] ?? ss[0]!).id
        })
        return remaining
      })
      for (const tab of tabs.filter((t) => t.spaceId === id)) closeTab(tab.id)
      // Deleting a space deletes the file it is. File is a system relation,
      // so the vault unlinks it.
      if (backed && id) spacesCollection.delete(id)
      log(`space ${id} deleted`)
    },
    [tabs, closeTab, log],
  )

  const renameTab = useCallback((id: number, title: string) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, title, renamed: true } : t)))
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
    (id: number, target: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab || tab.spaceId === target) return
      closeTab(id)
      const moved = openTab(tab.url, { space: target, pinned: tab.pinned, activate: false })
      if (moved !== undefined && tab.renamed) {
        setTabs((ts) =>
          ts.map((t) => (t.id === moved ? { ...t, title: tab.title, renamed: true } : t)),
        )
      }
      log(`tab ${id} → ${target}`)
    },
    [tabs, closeTab, openTab, log],
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
    shellRef.current?.style.setProperty('--hue', String(space.hue))
    shellRef.current?.style.setProperty('--space-position', String(spaceIndex))
  }, [space.hue, spaceIndex])

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
      onContextMenu={(e) => tabMenu.open(e, tab.id)}
      editing={renamingTab === tab.id}
      onRename={(title) => renameTab(tab.id, title)}
      onCancelRename={() => setRenamingTab(null)}
      pinned={tab.pinned}
      onSelect={() => setActiveBySpace((m) => ({ ...m, [tab.spaceId]: tab.id }))}
      onTogglePin={() =>
        setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, pinned: !t.pinned } : t)))
      }
      onClose={() => closeTab(tab.id)}
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

                <SpaceHeader
                  emoji={sp.emoji}
                  onContextMenu={(e) => spaceMenu.open(e, sp.id)}
                  editing={renaming === sp.id}
                  onRename={(name) => renameSpace(sp.id, name)}
                  onCancelRename={() => setRenaming(null)}
                >
                  {sp.name}
                </SpaceHeader>
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
                .filter((sp) => sp.id !== tabs.find((t) => t.id === tabMenu.anchor?.target)?.spaceId)
                .map((sp) => (
                  <ContextMenuItem
                    key={sp.id}
                    onSelect={() => {
                      moveTab(tabMenu.anchor?.target ?? -1, sp.id)
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
              closeTab(tabMenu.anchor?.target ?? -1)
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
