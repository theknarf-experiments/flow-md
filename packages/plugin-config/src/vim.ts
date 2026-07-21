// A vim-flavoured keymap file, parsed into (keys, action) pairs.
//
// The format is a deliberately small subset of what a .vimrc looks like, so
// that it reads as one to anyone who's touched vim:
//
//   " flow-md hotkeys — only the ones you've changed live here
//   map <C-j> next-tab
//   map <D-t> new-tab
//   map gg    scroll-top
//   unmap <C-k>
//
// `map <lhs> <rhs>` binds a key notation to an action name. `<rhs>` is a
// flow-md action id rather than a vim command, because the actions are the
// app's, not the editor's. A `"` starts a comment. `unmap <lhs>` records that
// a default should be turned off — kept as a fact so the shell can honour it.
//
// Only overrides live in the file: an action the user hasn't touched isn't
// mentioned, and the shell keeps its default. That's why the parser records
// exactly what's written and invents nothing.

export interface Binding {
  /** 1-based line the binding sits on — its identity for write-back. */
  line: number
  /** Canonical key string, e.g. "Ctrl+J", "Mod+T", "G G". */
  keys: string
  /** The action id, e.g. "next-tab"; empty for an unmap. */
  action: string
  /** True for `unmap` — the default is turned off rather than rebound. */
  unmap: boolean
  /** The key notation exactly as written, so a rewrite can leave it be. */
  rawKeys: string
}

const MAP = /^\s*(map|unmap|nnoremap|noremap)\s+(\S+)(?:\s+(.+?))?\s*$/

/** One vim key notation → a canonical chord string.
 *
 *  `<C-j>` → "Ctrl+J", `<D-t>` → "Mod+T" (D is Command in MacVim, which is the
 *  closest vim has to the ⌘ these bindings use), `<S-g>` → "Shift+G". A bare
 *  sequence like `gg` becomes "G G", the space-separated form the shell's
 *  sequence manager speaks. Unknown notation is passed through untouched, so a
 *  typo fails loudly at binding time rather than being silently dropped. */
export function keysToChord(raw: string): string {
  const mods: Record<string, string> = { c: 'Ctrl', d: 'Mod', m: 'Alt', a: 'Alt', s: 'Shift' }
  const parts = raw.match(/<[^>]+>|[^<]/g) ?? []
  const out: string[] = []
  for (const part of parts) {
    const angle = part.match(/^<([^>]+)>$/)
    if (!angle) {
      // A bare character is one step of a sequence.
      out.push(part.toUpperCase())
      continue
    }
    const segs = angle[1]!.split('-')
    const key = segs.pop() ?? ''
    const chord = segs
      .map((m) => mods[m.toLowerCase()] ?? m)
      .concat(named(key))
      .join('+')
    out.push(chord)
  }
  return out.join(' ')
}

/** vim's names for keys that aren't a single letter. */
function named(key: string): string {
  const map: Record<string, string> = {
    cr: 'Enter',
    esc: 'Escape',
    space: 'Space',
    tab: 'Tab',
    bs: 'Backspace',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
  }
  return map[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/** The reverse: a canonical chord string back to vim notation, for writing a
 *  binding a person didn't type. "Ctrl+J" → "<C-j>", "G G" → "gg". */
export function chordToKeys(chord: string): string {
  const modToVim: Record<string, string> = {
    ctrl: 'C',
    mod: 'D',
    meta: 'D',
    alt: 'M',
    shift: 'S',
  }
  return chord
    .split(' ')
    .map((step) => {
      const segs = step.split('+')
      const key = segs.pop() ?? ''
      const vimKey = key.length === 1 ? key.toLowerCase() : key
      if (!segs.length) return vimKey
      return `<${segs.map((m) => modToVim[m.toLowerCase()] ?? m).join('-')}-${vimKey}>`
    })
    .join('')
}

export function parseVim(content: string): Binding[] {
  const out: Binding[] = []
  content.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('"')) return
    const m = MAP.exec(line)
    if (!m) return
    const unmap = m[1] === 'unmap'
    const rawKeys = m[2]!
    const action = (m[3] ?? '').trim()
    // A map with no action, or an unmap with one, is malformed — skip it
    // rather than record a half-binding.
    if (!unmap && !action) return
    out.push({
      line: i + 1,
      keys: keysToChord(rawKeys),
      action: unmap ? '' : action,
      unmap,
      rawKeys,
    })
  })
  return out
}
