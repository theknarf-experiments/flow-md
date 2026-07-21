// The shell's view of the markdown vault.
//
// Everything goes through the vault's HTTP API: queries in, fact edits out.
// The shell holds no model of its own — a space *is* a markdown file, and
// changing one means writing to that file.
//
// Getting at that API is the awkward part. An Isolated Web App's CSP fixes
// connect-src to `'self' https: wss: blob: data:`, so http://localhost:4747 is
// unreachable from here however local it is. Chrome's dev-mode proxy forwards
// GETs to the dev server, which can proxy them onward — but not POSTs, so
// reads would work and every write would come back 405.
//
// A guest frame is not subject to its embedder's CSP. So the vault serves a
// page (`/bridge`) that does nothing but fetch on our behalf and post the
// answer back, and the shell loads it into an invisible Controlled Frame. One
// channel, both directions, no exception for writes.

import type { ControlledFrame } from '../controlled-frame.js'
import { controlledFrame } from './env.js'

const ORIGIN = 'http://localhost:4747'

export type Cell = string | number

export interface QueryResult {
  error: string | null
  columns: string[]
  writable: string[]
  rows: Cell[][]
}

export type Status = 'connecting' | 'connected' | 'offline'

let status: Status = 'connecting'

type Send = (path: string, init?: RequestInit) => Promise<string>

/** The relay, as a script to run inside the guest.
 *
 *  executeScript returns a completion value but does not resolve promises —
 *  an async IIFE comes back as `{}` — so a request can't be awaited in one
 *  call. It starts the fetch, parks the answer on the guest's window under
 *  the id it was given, and a later call reads it. Clunky, and the same
 *  pattern the favicon probe uses, for the same reason.
 *
 *  postMessage would be tidier and does work, but only until the embedder
 *  reloads: the guest keeps answering to a window that no longer exists. */
const START = (id: number, path: string, init: RequestInit) => `(() => {
  const w = window
  w.__flowmdVault = w.__flowmdVault || {}
  if (w.__flowmdVault[${id}] !== undefined) return 1
  w.__flowmdVault[${id}] = null
  fetch(${JSON.stringify(path)}, ${JSON.stringify(init)})
    .then((r) => r.text())
    .then((t) => { w.__flowmdVault[${id}] = { body: t } })
    .catch((e) => { w.__flowmdVault[${id}] = { error: String(e) } })
  return 1
})()`

const READ = (id: number) => `(() => {
  const slot = (window.__flowmdVault || {})[${id}]
  if (!slot) return ''
  delete window.__flowmdVault[${id}]
  return JSON.stringify(slot)
})()`

let bridge: Promise<Send> | null = null
let frameFor: HTMLElement | null = null

/** Load the relay once, and hand back something shaped like fetch. */
function connect(): Promise<Send> {
  if (bridge) return bridge
  const pending = new Promise<Send>((ready, failed) => {
    if (!controlledFrame.available) {
      failed(new Error('no <controlledframe>: the vault is only reachable from the app'))
      return
    }
    // Reuse the frame across retries; a failed attempt leaves a loaded guest
    // behind, and appending a second one would leave the first orphaned.
    const frame = (frameFor ??
      (frameFor = document.createElement('controlledframe'))) as ControlledFrame
    frame.setAttribute('partition', 'persist:flowmd-vault')
    frame.setAttribute('src', `${ORIGIN}/bridge`)
    // Present, laid out, invisible: a frame that is `display: none` never
    // loads, and one outside the document has no window to script.
    frame.setAttribute('style', 'position:fixed;width:1px;height:1px;opacity:0;left:-10px')
    if (!frame.isConnected) document.body.append(frame)

    let seq = 0
    /** Run a script in the guest, but not for ever. A frame whose page never
     *  loaded doesn't reject in any hurry, so without a clock of our own the
     *  first attempt can outlast everything waiting on it — which is how a
     *  browser with no vault sat there saying "connecting" instead of saying
     *  so. */
    const exec = async (code: string, ms = 2000): Promise<unknown> => {
      if (typeof frame.executeScript !== 'function') {
        throw new Error('this build of Controlled Frame cannot run scripts')
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const res = (await Promise.race([
          frame.executeScript({ code }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('the vault bridge is not answering')), ms)
          }),
        ])) as unknown
        return Array.isArray(res) ? res[0] : res
      } finally {
        clearTimeout(timer)
      }
    }

    const send: Send = async (path, init) => {
      const id = ++seq
      await exec(START(id, ORIGIN + path, init ?? {}))
      // Poll for the answer. The vault is local and answers in a few ms; the
      // ceiling is for when it doesn't answer at all.
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((r) => setTimeout(r, attempt < 10 ? 20 : 60))
        const raw = String((await exec(READ(id))) ?? '')
        if (!raw) continue
        const slot = JSON.parse(raw) as { body?: string; error?: string }
        if (slot.error) throw new Error(slot.error)
        return slot.body ?? ''
      }
      throw new Error(`vault timed out: ${path}`)
    }

    // Ready once the guest will run a script. `loadstop` is the signal, but
    // it can fire before anything is listening, so this also polls — and
    // patiently: on a cold start the browser is bringing up a window, an app
    // process and a guest process at the same time, and six seconds turned
    // out to be optimistic.
    let done = false
    const attempt = async (): Promise<boolean> => {
      if (done) return true
      try {
        if ((await exec('1')) === undefined) return false
      } catch {
        return false
      }
      done = true
      ready(send)
      return true
    }
    frame.addEventListener('loadstop', () => void attempt())
    // A deadline rather than a number of tries: what matters is how long
    // someone is left looking at a window that hasn't said anything yet. Five
    // seconds, then the shell reports itself offline — and the next poll
    // starts a fresh attempt, so it comes back on its own when the vault does.
    void (async () => {
      const until = Date.now() + 5000
      while (!done && Date.now() < until) {
        if (await attempt()) return
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!done) failed(new Error('the vault is not answering on ' + ORIGIN))
    })()
  })
  // A failed connection is not a permanent verdict: the vault may simply not
  // have been running yet. Caching the rejection would leave the browser
  // offline until it was restarted, which is what used to happen.
  bridge = pending
  pending.catch(() => {
    if (bridge === pending) bridge = null
    frameFor = null
  })
  return pending
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const send = await connect()
    const answer = JSON.parse(await send(path, init)) as T
    status = 'connected'
    return answer
  } catch (err) {
    // Reaching the vault at all is what this reports. A query the vault
    // answered with an error still counts as connected — see rowsOf().
    status = 'offline'
    throw err
  }
}

const mutate = <T,>(path: string, data: unknown): Promise<T> => json<T>(path, body(data))

const body = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
})

export const vault = {
  /** Whether the vault is reachable. Not whether it liked the last query. */
  status: (): Status => status,

  async available(): Promise<boolean> {
    try {
      const health = await json<{ ok: boolean }>('/health')
      return health.ok
    } catch {
      return false
    }
  },

  run(query: string): Promise<QueryResult> {
    return json(`/run?q=${encodeURIComponent(query)}`)
  },

  /** Add a fact. Locator columns the caller can't know (a line) go as 0. */
  insert(rel: string, row: Cell[]): Promise<{ error: string | null }> {
    return mutate('/insert', { rel, row })
  },

  /** Write a file whole, creating it if absent — the way a per-profile
   *  history file first comes into being, with just its header. */
  save(path: string, content: string): Promise<{ error: string | null }> {
    return json('/file', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    })
  },

  /** Edit one cell of a query result — the vault traces it back to the file. */
  update(
    query: string,
    row: Cell[],
    column: string,
    value: Cell,
  ): Promise<{ error: string | null }> {
    return mutate('/update', { q: query, row, column, value })
  },

  /** Remove what a query row was derived from. `rel` says which relation to
   *  remove when a query reaches more than one that could be — a join over
   *  the tree touches both the node and the file's frontmatter, and only one
   *  of those is the tab. */
  delete(query: string, row: Cell[], rel?: string): Promise<{ error: string | null }> {
    return mutate('/delete', { q: query, row, ...(rel ? { rel } : {}) })
  },
}
