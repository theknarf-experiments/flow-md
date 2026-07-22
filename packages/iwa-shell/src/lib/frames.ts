// A thin imperative wrapper around <controlledframe>.
//
// Deliberately outside React's reconciliation. Two reasons: `partition` has
// to be set *before* `src` or it silently doesn't apply, and a guest must
// never be unmounted/remounted by a re-render — that would throw away the
// page. React owns the chrome; this owns the guests.

import type {
  ContextMenusClickEvent,
  ControlledFrame,
  NewWindowEvent,
} from '../controlled-frame.js'
import { controlledFrame } from './env.js'

export interface FrameInfo {
  title: string
  url: string
  bytes: number
  /** The guest's favicon as a data: URL, or null while it's still being
   *  fetched. Not the plain href: an IWA's CSP allows `img-src … https: data:`
   *  but not `http:`, so a localhost guest's icon would be blocked. Fetching
   *  it inside the guest and inlining it sidesteps that for every scheme. */
  icon: string | null
}

// executeScript returns the completion value but does *not* resolve promises
// (an async IIFE comes back as {}), so this can't await the fetch. Instead it
// starts the fetch on first call, caches the result on the guest's window,
// and returns it on a later call.
const PROBE = `(() => {
  const w = window
  if (w.__flowmdIcon === undefined) {
    w.__flowmdIcon = null
    const link = document.querySelector('link[rel~="icon"]')
    const href = link ? link.href : location.origin + '/favicon.ico'
    fetch(href)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('no icon'))))
      .then((b) => {
        if (b.size > 200000) throw new Error('icon too large')
        const fr = new FileReader()
        fr.onload = () => { w.__flowmdIcon = String(fr.result) }
        fr.readAsDataURL(b)
      })
      .catch(() => { w.__flowmdIcon = '' })
  }
  return JSON.stringify({
    title: document.title,
    url: location.href,
    bytes: document.documentElement.outerHTML.length,
    icon: w.__flowmdIcon || null,
  })
})()`

export interface FrameHandle {
  readonly el: HTMLElement
  /** The container this guest was built against. A partition can't be changed
   *  once `src` is set, so moving a space to another profile means building
   *  the guest again — this is what the shell compares to notice. */
  readonly partition: string
  navigate(url: string): void
  reload(): void
  back(): void
  forward(): void
  canGoBack(): Promise<boolean>
  canGoForward(): Promise<boolean>
  /** Reads the guest's DOM — the web-archive primitive. */
  probe(): Promise<FrameInfo | null>
  /** Teaches a freshly loaded guest which keys to hand back to the shell. */
  adopt(claims: KeyClaim[]): Promise<void>
  /** Labels every clickable thing in view and waits for a label to be typed. */
  hint(newTab: boolean): Promise<number>
  /** What the guest is playing, if anything — polled, because nothing in the
   *  Controlled Frame API pushes a change. */
  sound(): Promise<Sound>
  setMuted(muted: boolean): void
  /** Play or pause the media the guest is playing, from the sidebar. */
  playPause(play: boolean): void
  /** Scrolls the guest by a number of px. Negative is up. */
  scrollBy(dy: number): void
  /** Scrolls by a fraction of the window — vim's ⌃d/⌃u, which move by half a
   *  screen so you keep a few lines of context either side of the jump. */
  scrollByScreens(fraction: number): void
  scrollToEdge(edge: 'top' | 'end'): void
  /** Read the selection, or the page's main content when nothing is picked. */
  capture(): Promise<Clip | null>
  /** Say something inside the page. */
  toast(message: string): void
  /** Add "Clip to the vault" to the guest's own right-click menu. */
  setClipMenu(onClip: () => void): void
  /** Put the caret in the page's first real text field — Vimium's `gi`. */
  focusInput(): void
  /** Hand the guest the userscripts it should run itself. Replaces whatever
   *  was registered before, so editing a script note re-registers rather than
   *  stacking a second copy. */
  setUserScripts(scripts: Array<{ name: string; matches: string[]; code: string }>): void
  /** Follow the page's own "next"/"previous" link, the way `]]` and `[[` do:
   *  paginated things nearly always label the way onward in the same handful
   *  of ways. */
  followRel(direction: 'next' | 'prev'): void
  setActive(active: boolean): void
  /** Which part of the card this guest fills, or null for the whole of it.
   *  Two visible guests is the only thing a split view is. */
  setSide(side: Side): void
  /** Whether this is the pane the keyboard is talking to. Only meaningful
   *  while the card is split — one pane needs no ring to say it's the one. */
  setFocus(focused: boolean): void
  /** Keep a playing video on screen after its tab stops being the active one:
   *  the video alone, in a corner. Pass the video's rectangle inside the page,
   *  or null to stop. */
  setPip(video: Rect | null, box?: Rect): void
  destroy(): void
}

/** A rectangle inside a guest's viewport, in its own css pixels. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where a pane sits when the card is split. Null is the undivided card. */
export type Side = 'left' | 'right' | 'top' | 'bottom' | null

/** The class names the shell uses to place and mark a guest. Passed as one
 *  object because they arrive together and there are too many to read as
 *  positional arguments. */
export interface PaneClasses {
  active: string
  pip: string
  focus: string
  left: string
  right: string
  top: string
  bottom: string
}

/** One of the shell's bindings, in a shape a guest can match a keydown against. */
export interface KeyClaim {
  key: string
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
}

/** Keys a guest hands back to the shell instead of handling itself.
 *
 *  A guest is a separate process with its own focus, so once you click a page
 *  the shell stops seeing keystrokes entirely — which would make every binding
 *  work only until you touched anything. This script re-posts the claimed ones
 *  to the embedder, which replays them as ordinary keydowns.
 *
 *  The claims are handed in rather than written here: they come from the
 *  shell's own hotkey registry, so a binding works inside a page for the same
 *  reason it works outside — there's one table, not a copy that drifts.
 *
 *  It stays out of the way where it should: a page's own text fields keep the
 *  keys that would be typing there. */
const forwardKeys = (claims: KeyClaim[]) => `(() => {
  const w = window
  // Set before the install guard, so re-adopting a guest updates the table.
  w.__flowmdClaims = ${JSON.stringify(claims)}
  if (w.__flowmdKeys) return
  w.__flowmdKeys = true
  let shell = null
  w.addEventListener('message', (e) => {
    if (e.data === 'flowmd:hello' && e.source) shell = e.source
  })
  const claimed = (e) => {
    // Hint mode owns the keyboard while it's up, letters included.
    if (w.__flowmdHints) return false
    const key = (e.key || '').toLowerCase()
    return w.__flowmdClaims.some((c) =>
      c.key === key && !!c.ctrl === e.ctrlKey && !!c.meta === e.metaKey &&
      !!c.alt === e.altKey && !!c.shift === e.shiftKey)
  }
  w.addEventListener(
    'keydown',
    (e) => {
      if (!shell || !claimed(e)) return
      const el = document.activeElement
      const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
      // Typing in the page is the page's business — but a chord is never
      // typing, so ⌘T still opens a tab from inside a search box.
      if (typing && !e.ctrlKey && !e.metaKey && !e.altKey) return
      e.preventDefault()
      shell.postMessage({
        flowmd: 'key', key: e.key, code: e.code,
        shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
      }, '*')
    },
    true,
  )
})()`

/** Vimium's `f`: label every clickable thing in view, then type a label.
 *
 *  The whole interaction runs inside the guest. Hints have to be drawn there
 *  anyway — only the guest knows where its links are, and labels in its own
 *  DOM stay glued to the page — and putting the keystroke handling there too
 *  means there's one implementation rather than one per focus state.
 *
 *  Opening in a new tab is a meta-click, which the guest reports as a
 *  `newwindow` and the shell writes into the space as a child of this tab.
 *  Same path as ⌘-clicking by hand, so hinted tabs land in the tree too. */
const hintScript = (newTab: boolean) => `(() => {
  const w = window
  // Home-row first, and no key that a page is likely to want back.
  const KEYS = 'sadfjklewcmpgh'
  if (w.__flowmdHintsCancel) w.__flowmdHintsCancel()

  const SEL = [
    'a[href]', 'button', 'select', 'textarea', 'summary', 'label',
    'input:not([type=hidden]):not([disabled])',
    '[role=button]', '[role=link]', '[role=tab]', '[role=checkbox]',
    '[onclick]', '[contenteditable=""]', '[contenteditable=true]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')

  const vw = innerWidth, vh = innerHeight
  const targets = []
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect()
    // On screen, and big enough to mean anything.
    if (r.width < 3 || r.height < 3) continue
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue
    targets.push({ el: el, r: r })
  }
  if (!targets.length) return 0
  // Reading order, so the shortest labels sit where the eye already is.
  targets.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)

  // Uniform-length labels in base-KEYS: no label is a prefix of another, so
  // a complete label is unambiguous the moment it's typed.
  let len = 1
  while (Math.pow(KEYS.length, len) < targets.length) len++
  const label = (i) => {
    let s = ''
    for (let d = 0; d < len; d++) {
      s = KEYS[i % KEYS.length] + s
      i = Math.floor(i / KEYS.length)
    }
    return s
  }

  // A shadow root so the page's CSS can't restyle the hints or vice versa.
  const host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = '<style>' +
    // Sits astride the top-left corner rather than over the text: a hint that
    // hides the first two letters of the link it labels is a hint you can't read.
    '.h{position:fixed;transform:translate(-5px,-72%);padding:1px 4px;border-radius:5px;' +
    'font:700 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.5px;' +
    'color:#3a2a00;background:linear-gradient(#ffe27a,#f7c948);border:1px solid #c99a10;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.45);white-space:nowrap}' +
    '.h.off{display:none}.h .u{opacity:.35}</style>'
  document.documentElement.append(host)

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    t.key = label(i)
    t.hit = true
    const tag = document.createElement('div')
    tag.className = 'h'
    tag.textContent = t.key.toUpperCase()
    root.append(tag)
    t.tag = tag
  }

  /** Puts every label back on its target.
   *
   *  Labels are viewport-positioned, which is what lets them work on pages
   *  that scroll a nested div or pin a sticky header — but it also means the
   *  page moving underneath them is a lie unless they're recomputed. So they
   *  are, on every scroll: cheaper than the alternative of throwing hint mode
   *  away because the page twitched. */
  const place = () => {
    for (const t of targets) {
      const r = t.el.getBoundingClientRect()
      t.tag.style.left = Math.max(0, r.left) + 'px'
      // Enough room for the chip to sit above the corner without clipping.
      t.tag.style.top = Math.max(11, r.top) + 'px'
      const seen = r.width >= 3 && r.height >= 3 &&
        r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      t.tag.classList.toggle('off', !t.hit || !seen)
    }
  }
  // Coalesced to a frame: a trackpad fling fires scroll far faster than paint.
  let queued = false
  const reflow = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; place() })
  }
  place()

  let typed = ''
  const cancel = () => {
    w.__flowmdHints = false
    w.__flowmdHintsCancel = null
    host.remove()
    removeEventListener('keydown', onKey, true)
    // Capture, because scroll doesn't bubble: this is how a nested scroller's
    // own scrolling gets seen at all.
    removeEventListener('scroll', reflow, true)
    removeEventListener('resize', reflow, true)
  }
  const activate = (t) => {
    const el = t.el
    cancel()
    // A field wants the caret, not a click.
    if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      el.focus()
      return
    }
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: w, metaKey: ${newTab},
    }))
  }
  const onKey = (e) => {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.key === 'Escape') return cancel()
    if (e.key === 'Backspace') typed = typed.slice(0, -1)
    else {
      const ch = e.key.toLowerCase()
      // Anything outside the alphabet means the hint was a mistake.
      if (ch.length !== 1 || KEYS.indexOf(ch) < 0) return cancel()
      typed += ch
    }
    let live = 0, only = null
    for (const t of targets) {
      t.hit = t.key.indexOf(typed) === 0
      if (!t.hit) continue
      // Counted whether or not it's still on screen: a label typed in full
      // should do what it says, even if scrolling has carried it off.
      live++
      only = t
      // Grey out what's already been typed, so what's left to type stands out.
      t.tag.innerHTML = '<span class="u">' + t.key.slice(0, typed.length).toUpperCase() +
        '</span>' + t.key.slice(typed.length).toUpperCase()
    }
    if (!live) return cancel()
    if (live === 1 && only.key === typed) return activate(only)
    place()
  }
  w.__flowmdHints = true
  w.__flowmdHintsCancel = cancel
  addEventListener('keydown', onKey, true)
  addEventListener('scroll', reflow, true)
  addEventListener('resize', reflow, true)
  return targets.length
})()`

/** What a clip is: the words, where they came from, and when.
 *
 *  `markdown` is the selection converted in the guest, where the DOM is — a
 *  clipped list stays a list and a clipped link keeps its target. */
export interface Clip {
  markdown: string
  text: string
  title: string
  /** The address the page calls its own, tracking parameters stripped. */
  url: string
  /** Where to go to see this again: the canonical url plus whatever gets you
   *  back to the spot — a text fragment for a selection, `t=` for a video. */
  link: string
  /** Who wrote it, when the page says so in one of the usual conventions. */
  byline: string
  /** The day the page says it was published (yyyy-mm-dd), if it says. */
  published: string
  /** Extra source detail, when the page is a kind we know: a tweet's author,
   *  the second of a video, a pdf's page. */
  note: string
  /** Whether Chrome's pdf viewer is what's showing — worth knowing because the
   *  page number then lives one frame further in. */
  pdf: boolean
}

/** Read the selection and the page around it.
 *
 *  The conversion happens here rather than in the shell because the DOM is
 *  here: what the eye selected is a range over live nodes, and turning it
 *  into markdown needs the elements, not a string of their text. A page we
 *  recognise adds one line about where in it you were — a video's timestamp
 *  is the difference between a clip you can return to and one you can't. */
const CAPTURE = `(() => {
  const sel = getSelection()
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null

  // Block-level tags become their markdown, inline ones their text. Anything
  // unrecognised falls through to its children, so unknown markup costs its
  // wrapper and not its words.
  // Page furniture is dropped when we're taking a whole article, kept when a
  // person selected it: they can select a heading on purpose, but nobody means
  // to clip a nav bar.
  const picked = !!(sel && sel.rangeCount && !sel.getRangeAt(0).collapsed)
  const skip = picked
    ? /^(script|style|noscript)$/
    : /^(script|style|noscript|nav|header|footer|aside|form|button)$/

  const md = (node, depth) => {
    if (node.nodeType === 3) return node.nodeValue.replace(/\\s+/g, ' ')
    if (node.nodeType !== 1) return ''
    const tag = node.tagName.toLowerCase()
    if (skip.test(tag)) return ''
    const kids = () => [...node.childNodes].map((n) => md(n, depth + 1)).join('')
    // Tables are layout as often as they are data; a row per line keeps both
    // readable instead of running the page into one paragraph.
    if (tag === 'tr') return '\\n' + kids()
    if (tag === 'td' || tag === 'th') return kids() + ' '
    if (tag === 'br') return '\\n'
    // Markdown's markers have to hug their text — ' *a* ' is emphasis, '* a *'
    // is not — but a space *inside* the element is often the only thing
    // separating it from the next word. So it's moved outside rather than
    // trimmed away, which is how "<em>Age of Empires</em> 4" stopped coming
    // out as "*Age of Empires*4".
    const wrap = (open, close) => {
      const k = kids()
      const inner = k.trim()
      if (!inner) return k
      return (/^\\s/.test(k) ? ' ' : '') + open + inner + close + (/\\s$/.test(k) ? ' ' : '')
    }
    if (tag === 'a' && node.href) return wrap('[', '](' + node.href + ')')
    if (tag === 'strong' || tag === 'b') return wrap('**', '**')
    if (tag === 'em' || tag === 'i') return wrap('*', '*')
    if (tag === 'code') return wrap('\`', '\`')
    if (tag === 'li') return '\\n' + '  '.repeat(Math.max(0, depth - 1)) + '- ' + kids().trim()
    if (/^h[1-6]$/.test(tag)) return '\\n\\n' + '#'.repeat(+tag[1]) + ' ' + kids().trim() + '\\n'
    if (tag === 'p' || tag === 'div' || tag === 'section') return '\\n\\n' + kids() + '\\n\\n'
    if (tag === 'blockquote') return '\\n\\n> ' + kids().trim() + '\\n\\n'
    if (tag === 'img' && node.alt) return '![' + node.alt + '](' + node.src + ')'
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return ''
    return kids()
  }

  let markdown = ''
  let text = ''
  if (range && !range.collapsed) {
    const frag = range.cloneContents()
    const holder = document.createElement('div')
    holder.append(frag)
    markdown = md(holder, 0)
    text = sel.toString()
  } else {
    // Nothing selected. A page's own idea of its main content is worth
    // clipping; the whole document is not — on a link-heavy front page that's
    // navigation, not knowledge, and clipping it once put 17kB of someone
    // else's menu in a vault. No article means no clip, and the caller says so.
    const main = document.querySelector('article, main, [role=main]')
    if (main) {
      markdown = md(main, 0)
      text = (main.innerText || '').trim()
    }
  }
  markdown = markdown
    // Runs of spaces collapse, but not at the start of a line: two spaces
    // there are a nested list item, and flattening them would flatten the list.
    .replace(/([^\\n])[ \\t]{2,}/g, '$1 ')
    // A line of nothing but spaces still separates paragraphs, and it isn't
    // caught by the blank-line collapse below until it's actually blank.
    .replace(/\\n[ \\t]+(?=\\n)/g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim()

  const attr = (selector, name) => {
    const el = document.querySelector(selector)
    if (!el) return ''
    return (name === 'text' ? el.textContent : el.getAttribute(name) || '').trim()
  }

  // The address worth keeping is the one the page calls itself, not the one
  // you happened to arrive by: canonical drops the session ids, the tracking
  // parameters and the #fragment left over from the last jump.
  const canonical = (() => {
    const declared = attr('link[rel=canonical]', 'href') || attr('meta[property="og:url"]', 'content')
    let u
    try {
      u = new URL(declared || location.href, location.href)
    } catch (e) {
      return location.href
    }
    if (!declared) {
      for (const key of [...u.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|mc_|igshid|si$|ref$|ref_src$|spm$)/.test(key)) {
          u.searchParams.delete(key)
        }
      }
      u.hash = ''
    }
    return u.href
  })()

  // Who wrote it. Several conventions, none of them universal; a url instead
  // of a name means the page pointed at a profile, which isn't a byline.
  const jsonLd = () => {
    for (const tag of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const seen = [].concat(JSON.parse(tag.textContent))
        for (const item of seen) {
          const a = item && (item.author || (item['@graph'] || []).map((g) => g.author).find(Boolean))
          const name = a && (typeof a === 'string' ? a : [].concat(a)[0] && [].concat(a)[0].name)
          if (name) return String(name)
        }
      } catch (e) {
        /* a page's own broken metadata is not our problem */
      }
    }
    return ''
  }
  let byline =
    attr('meta[name=author]', 'content') ||
    attr('meta[property="article:author"]', 'content') ||
    attr('[itemprop=author] [itemprop=name]', 'text') ||
    attr('[rel=author]', 'text') ||
    jsonLd()
  if (/^https?:/i.test(byline) || byline.length > 80) byline = ''

  const published = (
    attr('meta[property="article:published_time"]', 'content') ||
    attr('meta[name="date"]', 'content') ||
    attr('time[datetime]', 'datetime')
  ).slice(0, 10)

  // Where in the page you were, for the kinds of page that have a "where" —
  // and, where it can be, a link that lands you back there.
  let note = ''
  let link = canonical
  const video = document.querySelector('video')
  if (video && video.currentTime > 1) {
    const t = Math.floor(video.currentTime)
    const mm = String(Math.floor(t / 60)).padStart(2, '0')
    const ss = String(t % 60).padStart(2, '0')
    note = 'at ' + mm + ':' + ss
    if (/youtube\\.com|youtu\\.be/.test(location.host)) {
      try {
        const u = new URL(canonical)
        u.searchParams.set('t', t + 's')
        link = u.href
      } catch (e) {
        /* leave the plain url */
      }
    }
  }
  // A pdf guest's own document is a stub: an empty body and a stylesheet from
  // Chrome's viewer extension. That marker is the reliable test — arxiv serves
  // papers from /pdf/1706.03762, with no extension for a url check to find.
  const isPdf = !!document.querySelector('link[href*="pdf_embedder"]')
  if (isPdf) {
    const page = /[#&]page=(\\d+)/.exec(location.hash)
    if (page) note = 'page ' + page[1]
  }
  const tweet = document.querySelector('article[data-testid="tweet"]')
  if (tweet) {
    const handle = /^\\/([^/]+)\\/status\\//.exec(new URL(canonical).pathname)
    if (handle) note = 'by @' + handle[1]
  }

  // A link back to the words themselves. Chrome scrolls to and highlights a
  // text fragment, so the source of a clip reopens at the sentence it came
  // from rather than the top of the page. Works anywhere, which is worth more
  // than knowing about any particular site.
  if (picked && text.trim() && !/#/.test(link)) {
    // encodeURIComponent leaves !'()* alone, and a stray ')' ends a markdown
    // link early — a clip of a sentence ending in a bracket produced a source
    // link that stopped halfway. The dash is escaped because the fragment
    // syntax gives it a meaning of its own.
    const enc = (s) =>
      encodeURIComponent(s)
        .replace(/-/g, '%2D')
        .replace(/\\(/g, '%28')
        .replace(/\\)/g, '%29')
    const w = text.trim().split(/\\s+/)
    const fragment =
      w.length <= 10
        ? enc(w.join(' '))
        : enc(w.slice(0, 5).join(' ')) + ',' + enc(w.slice(-5).join(' '))
    link = link + '#:~:text=' + fragment
  }

  return JSON.stringify({
    // A clip is a note, not a mirror of the page.
    markdown: markdown.slice(0, 8000),
    text: text.slice(0, 8000),
    title: document.title,
    url: canonical,
    link: link,
    pdf: isPdf,
    byline: byline,
    published: published,
    note: note,
  })
})()`

/** What page of a pdf you're looking at.
 *
 *  Chrome renders a pdf by handing it to its own viewer extension, which lives
 *  in a frame *inside* the guest — so the guest's own document is a stub with
 *  no title, no text and no page number, which is what made this look
 *  impossible at first. `allFrames` reaches the viewer, and its shadow root is
 *  open, so the page selector can simply be read. The text can't: it belongs
 *  to the PDFium plugin, whose message channel refuses an injected caller. */
const PDF_PAGE = `(() => {
  if (!location.href.startsWith('chrome-extension://')) return ''
  const deep = (root, sel) => {
    const hit = root.querySelector(sel)
    if (hit) return hit
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const inner = deep(el.shadowRoot, sel)
        if (inner) return inner
      }
    }
    return null
  }
  const input = deep(document, 'input#pageSelector')
  return input && input.value ? String(input.value) : ''
})()`

/** A word from the browser, inside the page, that a clip was taken. Drawn in
 *  the guest so it appears where you were looking rather than in the chrome. */
const TOAST = (message: string) => `(() => {
  const id = '__flowmdToast'
  document.getElementById(id)?.remove()
  const el = document.createElement('div')
  el.id = id
  el.textContent = ${JSON.stringify(message)}
  el.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:14px;bottom:14px;' +
    'padding:7px 11px;border-radius:9px;pointer-events:none;' +
    'font:600 12px/1.3 ui-sans-serif,system-ui,sans-serif;color:#0d1f14;' +
    'background:linear-gradient(#b8f5cf,#8fe3b0);box-shadow:0 4px 14px rgba(0,0,0,.35);' +
    'opacity:0;transition:opacity 140ms ease'
  document.documentElement.append(el)
  requestAnimationFrame(() => { el.style.opacity = '1' })
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300) }, 1400)
})()`

/** Whatever actually scrolls: the document, or the first inner box with
 *  overflow — which is what most app-shaped pages scroll instead. */
const SCROLLER = `(() => {
  const el = document.scrollingElement || document.documentElement
  if (el.scrollHeight > el.clientHeight) return el
  return [...document.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 40) || el
})()`

/** Smooth scrolling that survives a held key.
 *
 *  Not `behavior: 'smooth'`: that restarts its animation on every press, so
 *  holding `j` stutters rather than glides. This keeps a running distance-left
 *  and eases it out, so presses pile onto one continuous motion — the faster
 *  they come, the faster the page moves. */
const GLIDE = `(() => {
  const w = window
  if (w.__flowmdGlide) return
  let el = null, left = 0, raf = 0, last = 0
  const frame = (now) => {
    // Clamped at zero as well as at the top: a rAF timestamp is the *start*
    // of the frame, which can precede the performance.now() taken when the
    // glide was kicked off, making the first dt negative. That produced a
    // backwards first move — and at the top of a page, where scrolling up
    // can't change scrollTop, the end-of-page check below then read it as
    // "already at the end" and killed the glide before it began.
    const dt = Math.max(0, Math.min(48, now - last))
    last = now
    // A fixed fraction of what's left per unit time, so the speed is the same
    // whatever the frame rate: ~150ms to settle.
    const move = left * (1 - Math.pow(0.0015, dt / 1000))
    const was = el.scrollTop
    el.scrollBy({ top: move, behavior: 'instant' })
    left -= move
    // Settled, or up against the end of the page — either way, stop.
    if (Math.abs(left) < 0.5 || (Math.abs(move) >= 1 && el.scrollTop === was)) {
      left = 0
      raf = 0
      return
    }
    raf = requestAnimationFrame(frame)
  }
  w.__flowmdGlideStop = () => { left = 0 }
  w.__flowmdGlide = (dy, scroller) => {
    el = scroller
    left += dy
    // Always restart rather than joining a loop that may not exist any more.
    // requestAnimationFrame doesn't fire in a hidden guest, so a glide started
    // while the tab was in the background leaves the handle set to a callback
    // that will never run — and every later press would then quietly
    // accumulate into a loop that had already died.
    if (raf) cancelAnimationFrame(raf)
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
})()`

/** What a guest is playing. `audible` comes from the frame (is it making
 *  noise), the rest from the page's own media elements — the frame knows
 *  about sound, only the DOM knows whether it's a video and what it's called. */
export interface Sound {
  audible: boolean
  muted: boolean
  playing: boolean
  video: boolean
  title: string
  /** Where the video is inside the page, when there is one. */
  rect: Rect | null
}

export const SILENT: Sound = {
  audible: false,
  muted: false,
  playing: false,
  video: false,
  title: '',
  rect: null,
}

/** The biggest media element that isn't done — the one a person would say the
 *  page "is playing". Silent autoplay decoration is skipped: a muted loop in
 *  a hero image isn't something anyone wants controls for. */
const MEDIA = `(() => {
  const els = [...document.querySelectorAll('video, audio')]
    .filter((m) => m.currentSrc || m.src || m.querySelector('source'))
    .filter((m) => !(m.muted && m.loop && m.tagName === 'VIDEO'))
  if (!els.length) return JSON.stringify(null)
  const playing = els.filter((m) => !m.paused && !m.ended)
  const area = (m) => (m.videoWidth || 0) * (m.videoHeight || 0) + (m.duration || 0)
  const m = (playing.length ? playing : els).sort((a, b) => area(b) - area(a))[0]
  const r = m.getBoundingClientRect()
  return JSON.stringify({
    playing: !m.paused && !m.ended,
    video: m.tagName === 'VIDEO' && !!m.videoWidth,
    title: document.title,
    // Where it sits in the page, for the corner to crop to. Reading a
    // rectangle tells the page nothing; moving one would.
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  })
})()`

/** Every script the shell injects into a guest, for the test that checks they
 *  parse.
 *
 *  These are JavaScript inside a TypeScript template literal, which is a trap
 *  worth a guard: a backslash written once becomes an escape the *template*
 *  eats, so `\n` arrives in the guest as a real newline inside a string
 *  literal (a syntax error), and `\s` arrives as a bare `s` (a regex that
 *  quietly matches the wrong thing). Both shipped before this existed. A
 *  backtick in a comment ends the literal outright, which at least fails
 *  loudly. Nothing here checks behaviour — only that a guest would accept it. */
export const GUEST_SCRIPTS: Record<string, string> = {
  PROBE,
  CAPTURE,
  MEDIA,
  SCROLLER,
  GLIDE,
  toast: TOAST('hello'),
  forwardKeys: forwardKeys([{ key: 'j' }]),
  hintScript: hintScript(false),
  hintScriptNewTab: hintScript(true),
}

/** The id the clip item is created under, and the one its click reports. */
const CLIP_ITEM = 'flowmd-clip'

/** How big the corner is, and how far it sits from the edges. */
const PIP_WIDTH = 320
const PIP_MARGIN = 16

const LIFECYCLE = ['loadcommit', 'loadstop', 'loadabort', 'load'] as const

export function createFrame(
  url: string,
  partition: string,
  container: HTMLElement,
  classes: PaneClasses,
  onLifecycle: () => void,
  /** The guest asked for a window of its own — ⌘-click, target=_blank,
   *  window.open. Given the url it wanted; the request itself is discarded. */
  onNewWindow?: (url: string) => void,
): FrameHandle {
  let el: HTMLElement
  if (controlledFrame.available) {
    const f = document.createElement('controlledframe') as ControlledFrame
    f.setAttribute('partition', partition)
    f.setAttribute('src', url)
    el = f as unknown as HTMLElement
  } else {
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    f.src = url
    el = f
  }
  container.append(el)
  for (const ev of LIFECYCLE) el.addEventListener(ev, onLifecycle)
  el.addEventListener('newwindow', (event) => {
    const e = event as NewWindowEvent
    // Nothing is attached to the request, so Chrome drops it — the url is
    // what matters and the embedder decides where it goes.
    e.preventDefault()
    e.window?.discard?.()
    if (e.targetUrl) onNewWindow?.(e.targetUrl)
  })

  const cf = () => el as unknown as ControlledFrame
  const call = async (fn?: () => unknown): Promise<boolean> => {
    try {
      return typeof fn === 'function' ? Boolean(await fn()) : false
    } catch {
      return false
    }
  }

  /** Run a snippet inside the guest, ignoring the result. Guests can be
   *  mid-navigation, in which case executeScript throws; nothing here is
   *  important enough to care. */
  const exec = async (code: string) => {
    const f = cf()
    if (typeof f.executeScript !== 'function') return
    try {
      await f.executeScript({ code })
    } catch {
      /* the guest wasn't ready */
    }
  }

  return {
    el,
    partition,
    navigate(next) {
      if (controlledFrame.available) cf().src = next
      else (el as HTMLIFrameElement).src = next
    },
    reload() {
      const f = cf()
      if (typeof f.reload === 'function') f.reload()
      else (el as HTMLIFrameElement).src = (el as HTMLIFrameElement).src
    },
    back() {
      cf().back?.()
    },
    forward() {
      cf().forward?.()
    },
    canGoBack: () => call((cf() as { canGoBack?: () => boolean }).canGoBack?.bind(cf())),
    canGoForward: () =>
      call((cf() as { canGoForward?: () => boolean }).canGoForward?.bind(cf())),
    async probe() {
      const f = cf()
      if (typeof f.executeScript !== 'function') return null
      try {
        const res = (await f.executeScript({ code: PROBE })) as unknown
        const raw = Array.isArray(res) ? res[0] : res
        return JSON.parse(String(raw)) as FrameInfo
      } catch {
        return null
      }
    },
    /** Installs the key forwarder and hands the guest a way to reach us. */
    async adopt(claims) {
      await exec(forwardKeys(claims))
      const f = cf() as { contentWindow?: Window | null }
      f.contentWindow?.postMessage('flowmd:hello', '*')
    },
    /** The hints are the guest's, and so is the typing that follows — which
     *  only reaches them if the guest has the keyboard. Pressing `f` from the
     *  chrome therefore hands focus over on the way in. */
    async hint(newTab) {
      const f = cf()
      if (typeof f.executeScript !== 'function') return 0
      try {
        const res = (await f.executeScript({ code: hintScript(newTab) })) as unknown
        el.focus()
        return Number(Array.isArray(res) ? res[0] : res) || 0
      } catch {
        return 0
      }
    },
    async sound() {
      const f = cf()
      if (typeof f.getAudioState !== 'function') return SILENT
      try {
        const [audible, muted] = await Promise.all([
          f.getAudioState(),
          f.isAudioMuted?.() ?? Promise.resolve(false),
        ])
        // Only ask the page when the frame says there's something to ask
        // about: executeScript on every guest every second is not free.
        if (!audible && !muted) return { ...SILENT }
        const res = (await f.executeScript?.({ code: MEDIA })) as unknown
        const raw = JSON.parse(String(Array.isArray(res) ? res[0] : res) || 'null') as
          | { playing: boolean; video: boolean; title: string; rect: Rect | null }
          | null
        return {
          audible: !!audible,
          muted: !!muted,
          playing: raw?.playing ?? !!audible,
          video: raw?.video ?? false,
          title: raw?.title ?? '',
          rect: raw?.rect ?? null,
        }
      } catch {
        return { ...SILENT }
      }
    },
    setMuted(muted) {
      cf().setAudioMuted?.(muted)
    },
    playPause(play) {
      void exec(`(() => {
        const els = [...document.querySelectorAll('video, audio')]
          .filter((m) => m.currentSrc || m.src)
        const m = els.sort((a, b) => (b.videoWidth || 0) - (a.videoWidth || 0))[0]
        if (!m) return
        ${play ? 'm.play()' : 'm.pause()'}
      })()`)
    },
    /** Scrolling happens inside the guest, so it has to be scripted in. */
    scrollBy(dy) {
      void exec(`(() => {
        ${GLIDE}
        window.__flowmdGlide(${dy}, ${SCROLLER})
      })()`)
    },
    /** The edges jump. A glide the length of a long page is a wait, not a
     *  gesture — `gg` means "take me there", not "take me there scenically". */
    /** A fraction of the viewport, measured inside the guest — the shell's
     *  window is a different size to the page's. */
    scrollByScreens(fraction) {
      void exec(`(() => {
        ${GLIDE}
        const target = ${SCROLLER}
        const page = target === (document.scrollingElement || document.documentElement)
          ? innerHeight
          : target.clientHeight
        window.__flowmdGlide(page * ${fraction}, target)
      })()`)
    },
    focusInput() {
      void exec(`(() => {
        const fields = [...document.querySelectorAll(
          'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]),' +
          'textarea, [contenteditable=""], [contenteditable=true]')]
        const seen = fields.find((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 20 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden'
        })
        if (!seen) return
        seen.focus()
        if (seen.select) seen.select()
      })()`)
    },
    async capture() {
      const f = cf()
      if (typeof f.executeScript !== 'function') return null
      try {
        const res = (await f.executeScript({ code: CAPTURE })) as unknown
        const raw = Array.isArray(res) ? res[0] : res
        const clip = JSON.parse(String(raw)) as Clip
        if (!clip.pdf) return clip
        // A pdf's page number lives one frame in, so it costs a second call —
        // made only for pdfs, because allFrames on an ordinary page would also
        // run in every ad and embed it happens to contain.
        const pages = (await f.executeScript({
          code: PDF_PAGE,
          allFrames: true,
        })) as unknown
        const page = (Array.isArray(pages) ? pages : [pages]).map(String).find((p) => p && p !== 'undefined')
        if (!page) return clip
        return {
          ...clip,
          note: `page ${page}`,
          // Chrome's viewer honours #page=, so the link reopens where you were.
          link: `${clip.url.split('#')[0]}#page=${page}`,
        }
      } catch {
        return null
      }
    },
    toast(message) {
      void exec(TOAST(message))
    },
    /** The guest draws its own context menu, and the browser will add an item
     *  to it on request — so clipping joins Copy and Look Up rather than the
     *  shell replacing a menu it can't draw over anyway. Selection *and* page,
     *  because clipping the article with nothing selected is also a thing. */
    setClipMenu(onClip) {
      const menus = cf().contextMenus
      if (typeof menus?.create !== 'function') return
      try {
        void menus.removeAll?.()
        void menus
          .create({ id: CLIP_ITEM, title: 'Clip to the vault', contexts: ['selection', 'page'] })
          .catch(() => undefined)
        // The click comes back as an event on the menu, carrying which item
        // was chosen — not as a callback handed to create(). That's the
        // <webview> spelling, and it's ignored here, which looks exactly like
        // a menu item that draws and then does nothing.
        //
        // Registered both ways the IDL allows. `contextMenus` is an EventTarget
        // on paper but a shim in practice — its addEventListener talks to the
        // browser's menu system rather than the DOM, so a dispatchEvent from
        // script never reaches it and neither spelling can be tested from here.
        // Setting both costs nothing and one of them is the live wire.
        // Both are registered, so if the browser honours both this would fire
        // twice — reading the page twice and reopening the sheet over itself.
        // A click nobody makes twice inside 300ms is the same click.
        let last = 0
        const clicked = (event: ContextMenusClickEvent) => {
          if (event.menuItem?.id !== CLIP_ITEM) return
          const now = Date.now()
          if (now - last < 300) return
          last = now
          onClip()
        }
        menus.addEventListener('click', clicked)
        ;(menus as { onclick?: (event: ContextMenusClickEvent) => void }).onclick = clicked
      } catch {
        /* an older build without the menu API; the chord still works */
      }
    },
    setUserScripts(scripts) {
      const f = cf()
      if (typeof f.addContentScripts !== 'function') return
      try {
        // Named after the note, so re-registering the same one replaces it.
        f.removeContentScripts?.(scripts.map((s) => s.name))
        if (!scripts.length) return
        // Controlled Frame's own names, not the webview extension ones it
        // grew out of: `urlPatterns` rather than `matches`, and a hyphenated
        // runAt. Passing the old spellings fails with nothing but "incorrect
        // naming" to go on.
        void f.addContentScripts(
          scripts.map((s) => ({
            name: s.name,
            urlPatterns: s.matches,
            js: { code: s.code },
            // Idle, not document-start: a script that rearranges a page wants
            // the page to exist. All frames, because the interesting bits of a
            // page are often in one.
            runAt: 'document-idle',
            allFrames: true,
          })),
        )
      } catch {
        /* a guest mid-navigation can refuse; the next sync re-registers */
      }
    },
    /** Matched on the link's own words and rel attribute rather than a site
     *  list: "next", "older", "›" and their opposites are how pagination
     *  actually labels itself, whatever the site. */
    followRel(direction) {
      const words =
        direction === 'next'
          ? ['next', 'older', 'more', '›', '»', '→', 'newer posts']
          : ['prev', 'previous', 'newer', '‹', '«', '←', 'older posts']
      void exec(`(() => {
        const words = ${JSON.stringify(words)}
        const rel = ${JSON.stringify(direction)}
        const byRel = document.querySelector('a[rel~="' + rel + '"], link[rel~="' + rel + '"]')
        if (byRel && byRel.href) { location.href = byRel.href; return }
        const links = [...document.querySelectorAll('a[href], button')]
        const hit = links.find((a) => {
          const text = (a.textContent || '').trim().toLowerCase()
          if (!text || text.length > 24) return false
          return words.some((w) => text === w || text.startsWith(w + ' ') || text.endsWith(' ' + w))
        })
        if (hit) hit.click()
      })()`)
    },
    scrollToEdge(edge) {
      void exec(`(() => {
        if (window.__flowmdGlideStop) window.__flowmdGlideStop()
        const target = ${SCROLLER}
        target.scrollTo({ top: ${edge === 'top' ? '0' : 'target.scrollHeight'}, behavior: 'instant' })
      })()`)
    },
    setActive(active) {
      el.classList.toggle(classes.active, active)
    },
    setSide(side) {
      el.classList.toggle(classes.left, side === 'left')
      el.classList.toggle(classes.right, side === 'right')
      el.classList.toggle(classes.top, side === 'top')
      el.classList.toggle(classes.bottom, side === 'bottom')
    },
    setFocus(focused) {
      el.classList.toggle(classes.focus, focused)
    },
    /** Show just the video, in the corner, without the page finding out.
     *
     *  The obvious approaches both tell it. Shrinking the frame resizes the
     *  guest's viewport, so a responsive player relayouts and a short can
     *  decide it's been minimised; restyling the video element is a DOM change
     *  any script can watch for. So the guest is left at full size, laid out
     *  exactly as it was, and the *compositor* does the work: clip-path keeps
     *  only the video's rectangle, and a transform carries it into the corner.
     *  Neither is observable from inside — no resize, no mutation, no event. */
    setPip(video, box) {
      el.classList.toggle(classes.pip, !!video)
      if (!video || video.w < 8 || video.h < 8) {
        el.style.removeProperty('clip-path')
        el.style.removeProperty('transform')
        return
      }
      // The frame's layout box is the card, and the guest's viewport is the
      // same size — so its coordinates and ours are the same coordinates.
      const width = el.offsetWidth
      const height = el.offsetHeight
      if (!width || !height) return
      const scale = (box?.w ?? PIP_WIDTH) / video.w
      const boxHeight = video.h * scale
      const left = box ? box.x : width - PIP_WIDTH - PIP_MARGIN
      const top = box ? box.y : height - boxHeight - PIP_MARGIN
      el.style.transformOrigin = '0 0'
      el.style.transform = `translate(${left - video.x * scale}px, ${top - video.y * scale}px) scale(${scale})`
      // Inset takes top/right/bottom/left, in the element's own space — which
      // is the untransformed one, so these are the page's numbers unscaled.
      el.style.clipPath = `inset(${video.y}px ${width - video.x - video.w}px ${
        height - video.y - video.h
      }px ${video.x}px round ${10 / scale}px)`
    },
    destroy() {
      for (const ev of LIFECYCLE) el.removeEventListener(ev, onLifecycle)
      el.remove()
    },
  }
}

/** Bare host, a scheme-guess, or a search. */
export function normalizeUrl(input: string, fallback: string): string {
  const s = input.trim()
  if (!s) return fallback
  if (/^https?:\/\//i.test(s)) return s
  if (/^[\w.-]+(:\d+)?(\/|$)/.test(s)) return `http://${s}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
}
