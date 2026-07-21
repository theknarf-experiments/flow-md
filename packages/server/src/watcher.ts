// Filesystem watcher: turns file events into Vault updates. The vault tells
// us which extensions its plugins claim, so non-matching files are skipped.
//
// chokidar v4 dropped glob support, so we watch each root directory and filter
// with an `ignored` predicate (only the vault's extensions; skip dotdirs and
// node_modules). File reads are serialized through a promise chain so a burst
// of edits can't interleave; advance() is debounced so one fixpoint covers a
// whole batch of changes.
//
// More than one root can be watched at once — a markdown vault and, say, a
// config directory under $XDG_CONFIG_HOME. Each root is a *mount* with a path
// prefix; files are keyed `<prefix>/<relpath>` so two roots can hold a file of
// the same name without colliding. The primary vault mounts at the empty
// prefix, which keeps its keys exactly what they were before mounts existed.

import { type FSWatcher, watch } from 'chokidar'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Vault } from './vault.js'

export interface WatchHandle {
  /** Resolves once every root's initial scan has loaded and the first advance ran. */
  ready: Promise<void>
  close(): Promise<void>
}

/** A directory to watch, and the key prefix its files take. */
export interface Mount {
  path: string
  /** '' for the primary vault; a folder-ish name for anything mounted beside it. */
  prefix: string
}

/** Accept the old single-root call as one mount at the empty prefix. */
function toMounts(roots: string | Mount | Array<string | Mount>): Mount[] {
  const list = Array.isArray(roots) ? roots : [roots]
  return list.map((r) => (typeof r === 'string' ? { path: r, prefix: '' } : r))
}

export function watchVault(
  roots: string | Mount | Array<string | Mount>,
  vault: Vault,
  debounceMs = 50,
): WatchHandle {
  const mounts = toMounts(roots)
  const watched = new Set(vault.watchedExtensions())

  let isReady = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<void> = Promise.resolve()
  // Folder set (empty folders included) → `Folder(path)` facts, across every
  // mount. chokidar emits addDir/unlinkDir; we keep the set and hand it over.
  const dirs = new Set<string>()

  const syncFolders = () => {
    vault.setFolders([...dirs])
    if (isReady) scheduleAdvance()
  }

  const scheduleAdvance = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      vault.advance()
    }, debounceMs)
  }

  const watchers: FSWatcher[] = []
  const readies: Array<Promise<void>> = []

  for (const mount of mounts) {
    const abs = path.resolve(mount.path)
    // Key = prefix + rel, forward slashes. The primary vault's prefix is '',
    // so its keys are just the relative path, unchanged.
    const key = (p: string) => {
      const r = path.relative(abs, p).split(path.sep).join('/')
      return mount.prefix ? `${mount.prefix}/${r}` : r
    }

    const queueSet = (p: string, mtimeMs: number) => {
      chain = chain
        .then(async () => {
          const k = key(p)
          const content = await readFile(p, vault.isBinaryPath(k) ? 'latin1' : 'utf8')
          vault.setFile(k, content, mtimeMs)
        })
        .catch(() => {
          // File vanished between event and read, or unreadable — ignore.
        })
        .then(() => {
          if (isReady) scheduleAdvance()
        })
    }

    const watcher: FSWatcher = watch(abs, {
      ignoreInitial: false,
      alwaysStat: true,
      ignored: (p, stats) => {
        const r = path.relative(abs, p)
        if (
          r &&
          r.split(path.sep).some((seg) => seg.startsWith('.') || seg === 'node_modules')
        ) {
          return true
        }
        if (!stats?.isFile()) return false
        return !watched.has(path.extname(p).toLowerCase())
      },
    })

    watcher.on('add', (p, stats) => queueSet(p, stats?.mtimeMs ?? Date.now()))
    watcher.on('change', (p, stats) => queueSet(p, stats?.mtimeMs ?? Date.now()))
    watcher.on('unlink', (p) => {
      vault.removeFile(key(p))
      if (isReady) scheduleAdvance()
    })
    watcher.on('addDir', (p) => {
      const k = key(p)
      // The root itself keys to '' (or the bare prefix) — not a folder fact.
      if (!k || k === mount.prefix) return
      dirs.add(k)
      syncFolders()
    })
    watcher.on('unlinkDir', (p) => {
      const k = key(p)
      if (!k || k === mount.prefix) return
      dirs.delete(k)
      for (const d of [...dirs]) if (d.startsWith(`${k}/`)) dirs.delete(d)
      syncFolders()
    })

    watchers.push(watcher)
    readies.push(new Promise<void>((resolve) => watcher.on('ready', () => resolve())))
  }

  const ready = Promise.all(readies).then(
    () =>
      new Promise<void>((resolve) => {
        // Drain the initial-scan read chain, then do the first build once.
        chain = chain.then(() => {
          vault.advance()
          isReady = true
          resolve()
        })
      }),
  )

  return {
    ready,
    async close() {
      if (timer) clearTimeout(timer)
      await Promise.all(watchers.map((w) => w.close()))
    },
  }
}
