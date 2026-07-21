// The shell's hotkeys, as the vault sees them.
//
// The config plugin parses ~/.config/flow-md/keys.vim into Keymap/Unmap facts,
// mounted under the `config` prefix. The shell reads them and lets them
// override its built-in bindings — an action the file rebinds uses the file's
// key, an action it unmaps is turned off, and everything else keeps its
// default. Only overrides live in the file, so the absence of a fact means
// "unchanged", never "unbound".

import { useEffect, useState } from 'react'
import { vault } from './vault.js'

export interface Keymap {
  /** action id → the chord it should use, when the file rebinds it. */
  overrides: Record<string, string>
  /** Default chords the file turned off. */
  unmapped: Set<string>
}

export const EMPTY_KEYMAP: Keymap = { overrides: {}, unmapped: new Set() }

const KEYMAP_QUERY = 'Keymap(path, action, keys, line)'
const UNMAP_QUERY = 'Unmap(path, keys, line)'

/** Read the keymap out of the engine. Degrades to no overrides if the config
 *  relations aren't there (an older vault, or one served without --config) —
 *  the same guard rowsOf() uses, so a missing relation never blanks the app. */
export async function loadKeymap(): Promise<Keymap> {
  try {
    const [maps, unmaps] = await Promise.all([vault.run(KEYMAP_QUERY), vault.run(UNMAP_QUERY)])
    if (maps.error || unmaps.error) return EMPTY_KEYMAP
    const overrides: Record<string, string> = {}
    for (const [, action, keys] of maps.rows as [string, string, string, number][]) {
      overrides[String(action)] = String(keys)
    }
    const unmapped = new Set<string>(
      (unmaps.rows as [string, string, number][]).map((r) => String(r[1])),
    )
    return { overrides, unmapped }
  } catch {
    return EMPTY_KEYMAP
  }
}

/** The keymap as React state, reloaded on an interval so editing keys.vim
 *  takes effect without a restart — the same live-from-the-vault story the
 *  rest of the shell follows. */
export function useKeymap(): Keymap {
  const [keymap, setKeymap] = useState<Keymap>(EMPTY_KEYMAP)
  useEffect(() => {
    let alive = true
    const load = () =>
      void loadKeymap().then((k) => {
        if (alive) setKeymap(k)
      })
    load()
    const timer = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return keymap
}
