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
  MediaBar,
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
import type { Hotkey } from '@tanstack/hotkeys'
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
import {
  type FrameHandle,
  type KeyClaim,
  type Sound,
  SILENT,
  createFrame,
  normalizeUrl,
} from './lib/frames.js'
import {
  type Space,
  type Tab as Row,
  addLink,
  moveLink,
  setDepth,
  spacesCollection,
  tabsCollection,
  DEFAULT_PROFILE,
  captureClip,
  deleteProfile,
  lastClosed,
  profilesOf,
  renameProfile,
  partitionFor,
  record,
  setProfile,
} from './lib/db.js'
import { type Keymap, useKeymap } from './lib/keymap.js'
import { type UserScript, loadUserScripts, matches } from './lib/userscripts.js'
import { type Status, vault } from './lib/vault.js'

const HOME = 'http://localhost:4748/'
/** Width to keep clear at the start of the toolbar row for the macOS traffic
 *  lights, which a frameless window draws over the top-left of our content.
 *  Hardcoded because Chrome exposes no metric for them — the same number
 *  Darc uses, less this sidebar's own padding. */
type BindOpts = { enabled?: boolean; meta?: { name?: string; category?: string; hidden?: boolean } }

/** Register a chord, resolved through the keymap: the file's rebind if there
 *  is one, otherwise the default written at the call site; disabled if the
 *  default was unmapped. The action id rides along in meta so the sheet and
 *  the guest claim-list can find it.
 *
 *  A cross-kind remap — a chord rebound to a sequence like `gg`, or the other
 *  way — can't move between the two hooks, so it's honoured only within its
 *  kind. That's the one gap; chord→chord and seq→seq cover the rest. */
function bindKey(
  keymap: Keymap,
  action: string,
  defaultChord: string,
  handler: () => void,
  opts: BindOpts = {},
): void {
  const override = keymap.overrides[action]
  // A sequence override (has a space) can't be honoured by useHotkey; ignore
  // it here so bindSeq can pick it up instead, and keep the default meanwhile.
  const chord = override && !override.includes(' ') ? override : defaultChord
  const disabled = keymap.unmapped.has(defaultChord)
  useHotkey(chord as Hotkey, handler, {
    ...opts,
    enabled: (opts.enabled ?? true) && !disabled,
    meta: { ...opts.meta, action },
  })
}

/** The sequence twin of bindKey. */
function bindSeq(
  keymap: Keymap,
  action: string,
  defaultSteps: string[],
  handler: () => void,
  opts: BindOpts = {},
): void {
  const override = keymap.overrides[action]
  const steps = override && override.includes(' ') ? override.split(' ') : defaultSteps
  const disabled = keymap.unmapped.has(defaultSteps.join(' '))
  useHotkeySequence(steps as Hotkey[], handler, {
    ...opts,
    enabled: (opts.enabled ?? true) && !disabled,
    meta: { ...opts.meta, action },
  })
}

declare module '@tanstack/hotkeys' {
  interface HotkeyMeta {
    /** Groups the binding in the shortcut sheet. */
    category?: string
    /** Bound and claimed like any other, but not listed on its own — for the
     *  members of a range the sheet describes in one line. */
    hidden?: boolean
    /** The keys.vim action id this binding answers to. */
    action?: string
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
  /** Naming a new profile for a space. A profile comes into being by being
   *  used, so the prompt carries the space that will be the first one in it. */
  const [profilePrompt, setProfilePrompt] = useState<{ space: string; value: string } | null>(
    null,
  )
  const [renamingProfile, setRenamingProfile] = useState<{ from: string; value: string } | null>(
    null,
  )
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

  const profiles = useMemo(() => profilesOf(spaces), [spaces])
  const space = spaces.find((s) => s.id === spaceId) ?? spaces[0]
  const spaceTabs = tabs.filter((t) => t.space === space?.id)
  const activeId = activeBySpace[spaceId] ?? spaceTabs[0]?.id ?? null
  const active = tabs.find((t) => t.id === activeId) ?? null
  const activeFrame = activeId ? frames.current.get(activeId) : undefined

  const log = useCallback((msg: string) => setLines((l) => [msg, ...l].slice(0, 200)), [])

  /** What each guest is playing. Polled rather than pushed: Controlled Frame
   *  reports audio state on request and raises no event when it changes, so
   *  the only way to know a tab started making noise is to ask. Every second
   *  is often enough to feel immediate and rare enough to be free — the ask
   *  is a no-op for guests that aren't audible. */
  const [sounds, setSounds] = useState<Record<string, Sound>>({})
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const entries = await Promise.all(
        [...frames.current.entries()].map(
          async ([id, frame]) => [id, await frame.sound()] as const,
        ),
      )
      if (!alive) return
      setSounds((prev) => {
        const next = Object.fromEntries(entries)
        // Same object when nothing changed, so this doesn't re-render the
        // window once a second forever.
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
        for (const k of keys) {
          const a = prev[k] ?? SILENT
          const b = next[k] ?? SILENT
          if (a.audible !== b.audible || a.muted !== b.muted || a.playing !== b.playing ||
              a.video !== b.video || a.title !== b.title) {
            return next
          }
        }
        return prev
      })
    }
    void tick()
    const timer = setInterval(() => void tick(), 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [tabs])

  /** Extensions, which are notes. Polled like the keymap, so editing a
   *  userscript note re-registers it without a restart. */
  const [scripts, setScripts] = useState<UserScript[]>([])
  useEffect(() => {
    let alive = true
    const load = () =>
      void loadUserScripts().then((s) => {
        if (alive) setScripts(s)
      })
    load()
    const timer = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  /** Give each guest the scripts that claim its url. Registered on the guest
   *  rather than injected by us, so they survive its own navigations. */
  useEffect(() => {
    const enabled = scripts.filter((s) => s.enabled)
    for (const [id, frame] of frames.current) {
      const row = tabsCollection.get(id)
      if (!row) continue
      frame.setUserScripts(
        enabled
          .filter((s) => matches(s.matches, row.url))
          .map((s) => ({ name: s.path, matches: s.matches, code: s.code })),
      )
    }
  }, [scripts, tabs])

  /** The tab making noise, preferring the one in the space you're looking at. */
  const noisy = useMemo(() => {
    const playing = tabs.filter((t) => sounds[t.id]?.audible || sounds[t.id]?.muted)
    return playing.find((t) => t.space === spaceId) ?? playing[0] ?? null
  }, [tabs, sounds, spaceId])

  const toggleMute = useCallback((id: string) => {
    const frame = frames.current.get(id)
    if (!frame) return
    const muted = !(sounds[id]?.muted ?? false)
    frame.setMuted(muted)
    // Optimistic, so the icon flips on the click rather than on the next poll.
    setSounds((s) => ({ ...s, [id]: { ...(s[id] ?? SILENT), muted } }))
  }, [sounds])

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
      const profile = spaces.find((sp) => sp.id === target)?.profile ?? DEFAULT_PROFILE
      void addLink(target, url, url, opts.under).then(() => {
        void record('opened', { url, title: url, space: target, profile })
        if (opts.activate === false) return
        const opened = tabsCollection.toArray
          .filter((t) => t.space === target && t.url === url)
          .sort((a, b) => a.start - b.start)
          .pop()
        if (opened) setActiveBySpace((m) => ({ ...m, [target]: opened.id }))
      })
      log(`tab → ${url}`)
    },
    [spaceId, spaces, log],
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
      void record('closed', {
        url: victim.url,
        title: victim.title,
        space: victim.space,
        profile: spaces.find((sp) => sp.id === victim.space)?.profile ?? DEFAULT_PROFILE,
      })
      log(`closed ${victim.url}`)
    },
    [spaces, log],
  )

  /** ⌘⇧T: the history says where a closed tab was, so putting it back is the
   *  same as opening it — the link goes into the space it was closed from,
   *  which may not be the space showing now. */
  const reopenLast = useCallback(async () => {
    // The history you're looking at is the one belonging to this space's
    // profile — a different profile is a different browser with its own past.
    const gone = await lastClosed(space?.profile ?? DEFAULT_PROFILE)
    if (!gone) {
      log('nothing closed to reopen')
      return
    }
    openTab(gone.url, { space: gone.space || spaceId })
  }, [openTab, spaceId, space, log])

  /** ⌘L: take what's on screen and put it in the space's file.
   *
   *  The clip lands in the same document as the tab it came from, so the page
   *  and the note about it are one file — and it carries an id of its own, the
   *  same kind a tab has, so a later query can treat them alike. Written as a
   *  blockquote, which is also what keeps its source link from opening as a
   *  tab: the tab list is a list, and clips aren't in it. */
  const capture = useCallback(async () => {
    const frame = activeId ? frames.current.get(activeId) : undefined
    if (!frame || !space) return
    const clip = await frame.capture()
    if (!clip?.markdown.trim()) {
      frame?.toast('Nothing to clip')
      return
    }
    const id = await captureClip(space.id, clip)
    // Said inside the page, where you were looking, rather than in the chrome.
    frame.toast(id ? 'Clipped to ' + space.name : 'Clip failed')
    log(id ? `clip → ${space.id}` : 'clip failed')
  }, [activeId, space, log])

  /** Rows in, guests out. The only place the document and the browser meet:
   *  every row gets a frame, every frame without a row is destroyed. There is
   *  nothing to reconcile because there is nothing else keeping score. */
  useEffect(() => {
    const container = cardRef.current
    if (!container) return
    const wanted = new Map(tabs.map((t) => [t.id, t]))

    for (const [id, row] of wanted) {
      const owner = spaces.find((s) => s.id === row.space)
      if (!owner) continue
      const built = frames.current.get(id)
      if (built) {
        // A space that moved to another profile browses in another container,
        // and a partition is fixed at creation — so the guest is rebuilt. That
        // is the point: the new profile shouldn't inherit the old one's login.
        if (built.partition === owner.partition) continue
        built.destroy()
        frames.current.delete(id)
      }
      const frame = createFrame(
        row.url,
        owner.partition,
        container,
        styles.frameActive!,
        styles.framePip!,
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

  // Only the active tab of the active space is visible — except a video that
  // was playing when you left it, which follows you into the corner. Arc's
  // trick, and it costs nothing here: the guest was never unloaded, so this
  // is the same live frame with different geometry.
  useEffect(() => {
    for (const [id, frame] of frames.current) {
      const active = id === activeId
      const sound = sounds[id]
      frame.setActive(active)
      frame.setPip(!active && !!sound?.video && !!sound.playing)
    }
    if (activeId !== null) void sync(activeId)
  }, [activeId, tabs.length, sync, sounds])

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

  /** The current space's tabs in the order the sidebar shows them: pinned
   *  first, because that's where the eye counts from. ⌘1 means the first
   *  thing in the list, whatever kind of tab that is. */
  const tabOrder = useCallback(() => {
    const inSpace = tabs.filter((t) => t.space === spaceId)
    return [...inSpace.filter((t) => t.pinned), ...inSpace.filter((t) => !t.pinned)]
  }, [tabs, spaceId])

  /** Move the selection through the current space's tabs, in the order the
   *  sidebar shows them. */
  const stepTab = useCallback(
    (delta: number) => {
      const order = tabOrder()
      if (order.length === 0) return
      const i = order.findIndex((t) => t.id === activeId)
      // From nowhere, j lands on the first tab and k on the last.
      const next = order[i < 0 ? (delta > 0 ? 0 : order.length - 1) : (i + delta + order.length) % order.length]
      if (next) setActiveBySpace((m) => ({ ...m, [spaceId]: next.id }))
    },
    [tabOrder, spaceId, activeId],
  )

  /** ⌘1…⌘9 — and ⌘9 is the last tab, not the ninth, the way browsers do it. */
  const jumpToTab = useCallback(
    (n: number) => {
      const order = tabOrder()
      const tab = n === 9 ? order[order.length - 1] : order[n - 1]
      if (tab) setActiveBySpace((m) => ({ ...m, [spaceId]: tab.id }))
    },
    [tabOrder, spaceId],
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

  /** Chords the shell owns. Every named one works inside a page too: guests
   *  are handed this table at adopt time and post the claimed keys back.
   *
   *  Each binding carries an action id — the same id keys.vim uses on the
   *  right of a `map`. bindKey/bindSeq resolve the id against the loaded
   *  keymap: a rebound action takes the file's key, an unmapped default is
   *  turned off, and an untouched one keeps the chord written here. */
  const keymap = useKeymap()
  const vim = (name: string) => ({ enabled: !command.open, meta: { name, category: 'Page' } })
  const tabs_ = (name: string) => ({ meta: { name, category: 'Tabs & spaces' } })
  const win = (name: string) => ({ meta: { name, category: 'Window' } })
  const nth = (n: number) => ({
    meta: { name: `Jump to tab ${n}`, category: 'Tabs & spaces', hidden: true },
  })

  bindKey(keymap, 'new-tab', 'Mod+T', () => setCommand({ open: true, value: '', newTab: true }), tabs_('New tab'))
  // ⌘L is Lazy's capture chord and the muscle memory worth matching; the
  // address bar keeps the same letter one modifier along.
  bindKey(keymap, 'capture', 'Mod+L', () => void capture(), tabs_('Clip to the vault'))
  bindKey(
    keymap,
    'edit-address',
    'Mod+Shift+L',
    () => setCommand({ open: true, value: active?.url ?? '', newTab: false }),
    win('Edit address'),
  )
  bindKey(keymap, 'toggle-sidebar', 'Mod+S', () => setSidebar((v) => !v), win('Show or hide the sidebar'))
  bindKey(
    keymap,
    'close-tab',
    'Mod+W',
    () => {
      if (activeId !== null) closeTab(activeId)
    },
    tabs_('Close tab'),
  )
  bindKey(keymap, 'settings', 'Mod+,', () => setSettings(true), win('Settings'))
  useHotkey('Escape', () => setCommand((c) => ({ ...c, open: false })))

  // ⌘R belongs to the page, not the window — reloading the shell would throw
  // away every guest to refresh one of them. preventDefault (on by default)
  // is what stops the window from reloading underneath us.
  bindKey(keymap, 'reload-tab', 'Mod+R', () => activeFrame?.reload(), tabs_('Reload the tab'))
  bindKey(keymap, 'next-tab', 'Control+J', () => stepTab(1), tabs_('Next tab'))
  bindKey(keymap, 'prev-tab', 'Control+K', () => stepTab(-1), tabs_('Previous tab'))
  bindKey(keymap, 'space-left', 'Control+H', () => stepSpace(-1), tabs_('Space to the left'))
  bindKey(keymap, 'space-right', 'Control+L', () => stepSpace(1), tabs_('Space to the right'))

  bindKey(keymap, 'scroll-down', 'J', () => activeFrame?.scrollBy(120), vim('Scroll down'))
  bindKey(keymap, 'scroll-up', 'K', () => activeFrame?.scrollBy(-120), vim('Scroll up'))
  bindKey(keymap, 'scroll-bottom', 'Shift+G', () => activeFrame?.scrollToEdge('end'), vim('Jump to the end'))
  bindSeq(keymap, 'scroll-top', ['G', 'G'], () => activeFrame?.scrollToEdge('top'), vim('Jump to the top'))
  bindKey(keymap, 'history-back', 'Shift+H', () => activeFrame?.back(), vim('Back'))
  bindKey(keymap, 'history-forward', 'Shift+L', () => activeFrame?.forward(), vim('Forward'))
  bindKey(keymap, 'reopen-tab', 'Mod+Shift+T', () => void reopenLast(), tabs_('Reopen the last closed tab'))
  // Nine registrations rather than a loop: hooks can't be called in one, and
  // the manager wants a literal chord per binding anyway. Only ⌘1 carries a
  // name, so the shortcuts sheet lists the range once instead of nine times.
  bindKey(keymap, 'jump-tab-1', 'Mod+1', () => jumpToTab(1), tabs_('Jump to tab 1–9 (9 is the last)'))
  bindKey(keymap, 'jump-tab-2', 'Mod+2', () => jumpToTab(2), nth(2))
  bindKey(keymap, 'jump-tab-3', 'Mod+3', () => jumpToTab(3), nth(3))
  bindKey(keymap, 'jump-tab-4', 'Mod+4', () => jumpToTab(4), nth(4))
  bindKey(keymap, 'jump-tab-5', 'Mod+5', () => jumpToTab(5), nth(5))
  bindKey(keymap, 'jump-tab-6', 'Mod+6', () => jumpToTab(6), nth(6))
  bindKey(keymap, 'jump-tab-7', 'Mod+7', () => jumpToTab(7), nth(7))
  bindKey(keymap, 'jump-tab-8', 'Mod+8', () => jumpToTab(8), nth(8))
  bindKey(keymap, 'jump-tab-9', 'Mod+9', () => jumpToTab(9), nth(9))
  // Vimium's fuller vocabulary. All bare keys, so they reach a focused page
  // through the same claim table as the rest.
  bindKey(keymap, 'scroll-half-down', 'D', () => activeFrame?.scrollByScreens(0.5), vim('Half a screen down'))
  bindKey(keymap, 'scroll-half-up', 'U', () => activeFrame?.scrollByScreens(-0.5), vim('Half a screen up'))
  bindKey(keymap, 'reload', 'R', () => activeFrame?.reload(), vim('Reload'))
  bindKey(keymap, 'close-tab-vim', 'X', () => { if (activeId !== null) closeTab(activeId) }, vim('Close the tab'))
  bindKey(keymap, 'restore-tab-vim', 'Shift+X', () => void reopenLast(), vim('Bring back the last closed tab'))
  bindKey(keymap, 'open', 'O', () => setCommand({ open: true, value: '', newTab: false }), vim('Open a url'))
  bindKey(keymap, 'open-new-tab', 'Shift+O', () => setCommand({ open: true, value: '', newTab: true }), vim('Open a url in a new tab'))
  bindSeq(keymap, 'copy-url', ['Y', 'Y'], () => { if (active) copyUrl(active.url) }, vim('Copy the url'))
  bindSeq(keymap, 'focus-input', ['G', 'I'], () => activeFrame?.focusInput(), vim('Focus the first field'))
  bindSeq(keymap, 'page-next', [']', ']'], () => activeFrame?.followRel('next'), vim('Follow "next"'))
  bindSeq(keymap, 'page-prev', ['[', '['], () => activeFrame?.followRel('prev'), vim('Follow "previous"'))
  bindKey(keymap, 'hint', 'F', () => void activeFrame?.hint(false), vim('Hint a link'))
  bindKey(keymap, 'hint-new-tab', 'Shift+F', () => void activeFrame?.hint(true), vim('Hint a link into a new tab'))

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
    const named = (meta?: { name?: string; hidden?: boolean }) => !!meta?.name && !meta.hidden
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
      { key: 'cmd:capture', icon: '✂', label: 'Clip to the vault', run: () => void capture() },
      { key: 'cmd:probe', icon: '⌘', label: 'Log page info', run: () => void logPageInfo() },
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
    // `capture` and `logPageInfo` are recreated per render but only read refs.
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
      profile: DEFAULT_PROFILE,
      partition: partitionFor(DEFAULT_PROFILE),
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

  const logPageInfo = async () => {
    if (!activeFrame) return
    setShowLog(true)
    const info = await activeFrame.probe()
    log(info ? `probe → ${JSON.stringify(info)}` : 'probe failed (no executeScript)')
  }

  /** Pinning is a url in the space's frontmatter, so it's an edit to the
   *  space rather than to the tab. */
  /** Pinning writes the tab's block id into the space's frontmatter. The id
   *  is what survives the tab going somewhere else; a url doesn't, and a pin
   *  that stops matching leaves a dead entry in the file and a tab back in
   *  the list. Unpinning clears a legacy url entry too, so files written the
   *  old way can be tidied by using them. */
  const togglePin = (tab: Row) => {
    const owner = spaces.find((s) => s.id === tab.space)
    if (!owner) return
    const key = tab.block ?? tab.url
    spacesCollection.update(owner.id, (draft) => {
      draft.pinned = tab.pinned
        ? draft.pinned.filter((u) => u !== key && u !== tab.url)
        : [...draft.pinned, key]
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
      audible={sounds[tab.id]?.audible ?? false}
      muted={sounds[tab.id]?.muted ?? false}
      onToggleMute={() => toggleMute(tab.id)}
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
          className={`${styles.trafficWell}${sidebar ? '' : ` ${styles.bare}`}`}
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
                    onContextMenu={(e, id) => tabMenu.open(e, String(id))}
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

        {/* Above the rail: it belongs to the window rather than to a space,
            because the thing playing keeps playing while you swipe away. */}
        {noisy && (
          <MediaBar
            title={sounds[noisy.id]?.title || noisy.title}
            playing={sounds[noisy.id]?.playing ?? false}
            muted={sounds[noisy.id]?.muted ?? false}
            onPlayPause={() =>
              frames.current.get(noisy.id)?.playPause(!(sounds[noisy.id]?.playing ?? false))
            }
            onToggleMute={() => toggleMute(noisy.id)}
            onSelect={() => {
              setSpaceId(noisy.space)
              setActiveBySpace((m) => ({ ...m, [noisy.space]: noisy.id }))
            }}
          />
        )}

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
          {/* Which container this space browses in. Switching is a frontmatter
              edit, so the guests are rebuilt against the new partition — a
              different profile is a different set of logins. */}
          <ContextMenuLabel>Profile</ContextMenuLabel>
          {profiles.map((name) => (
            <ContextMenuItem
              key={name}
              onSelect={() => {
                void setProfile(spaceMenu.anchor?.target ?? '', name)
                spaceMenu.close()
              }}
            >
              <span aria-hidden="true">
                {spaces.find((sp) => sp.id === spaceMenu.anchor?.target)?.profile === name
                  ? '●'
                  : '○'}
              </span>
              {name}
            </ContextMenuItem>
          ))}
          <ContextMenuItem
            onSelect={() => {
              const target = spaceMenu.anchor?.target ?? ''
              spaceMenu.close()
              setProfilePrompt({ space: target, value: '' })
            }}
          >
            New profile…
          </ContextMenuItem>
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
              if (tab) togglePin(tab)
              tabMenu.close()
            }}
          >
            {tabs.find((t) => t.id === tabMenu.anchor?.target)?.pinned ? 'Unpin tab' : 'Pin tab'}
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

      {/* Naming a profile. A sheet rather than a prompt() — the shell disables
          the native dialogs along with the native menu. */}
      <Sheet
        open={!!profilePrompt}
        title="New profile"
        onClose={() => setProfilePrompt(null)}
      >
        <SheetSection title="Name">
          <form
            className={styles.profileForm}
            onSubmit={(e) => {
              e.preventDefault()
              const name = profilePrompt?.value.trim()
              if (name && profilePrompt) void setProfile(profilePrompt.space, name)
              setProfilePrompt(null)
            }}
          >
            <input
              className={styles.profileInput}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the sheet exists to be typed in
              autoFocus
              value={profilePrompt?.value ?? ''}
              placeholder="work"
              aria-label="Profile name"
              onChange={(e) =>
                setProfilePrompt((p) => (p ? { ...p, value: e.target.value } : p))
              }
            />
            <SidebarButton type="submit">Create and switch</SidebarButton>
          </form>
          <p className={styles.profileHint}>
            A profile is its own set of cookies and logins, with its own history
            file. This space moves into it; other spaces keep theirs.
          </p>
        </SheetSection>
      </Sheet>

      <Sheet open={settings} title="Settings" onClose={() => setSettings(false)}>
        <SheetSection title="Profiles">
          {/* Each row is a container: the spaces in it share cookies and a
              history file. Deleting one moves its spaces elsewhere rather
              than taking them with it. */}
          <ul className={styles.profileList}>
            {profiles.map((name) => {
              const inProfile = spaces.filter((sp) => sp.profile === name)
              return (
                <li key={name} className={styles.profileRow}>
                  <span className={styles.profileName}>{name}</span>
                  <span className={styles.profileCount}>
                    {inProfile.length === 1 ? '1 space' : `${inProfile.length} spaces`}
                  </span>
                  <SidebarButton
                    onClick={() => setRenamingProfile({ from: name, value: name })}
                  >
                    Rename
                  </SidebarButton>
                  <SidebarButton
                    disabled={profiles.length < 2}
                    onClick={() => void deleteProfile(spaces, name)}
                  >
                    Delete
                  </SidebarButton>
                </li>
              )
            })}
          </ul>
          {renamingProfile && (
            <form
              className={styles.profileForm}
              onSubmit={(e) => {
                e.preventDefault()
                const to = renamingProfile.value.trim()
                if (to) void renameProfile(spaces, renamingProfile.from, to)
                setRenamingProfile(null)
              }}
            >
              <input
                className={styles.profileInput}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- opened to be typed in
                autoFocus
                value={renamingProfile.value}
                aria-label={`Rename profile ${renamingProfile.from}`}
                onChange={(e) =>
                  setRenamingProfile((r) => (r ? { ...r, value: e.target.value } : r))
                }
              />
              <SidebarButton type="submit">Rename</SidebarButton>
            </form>
          )}
        </SheetSection>
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
