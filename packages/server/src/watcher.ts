// Filesystem watcher: turns markdown file events into Vault updates.
//
// chokidar v4 dropped glob support, so we watch the root directory and filter
// with an `ignored` predicate (only *.md files; skip dotdirs and
// node_modules). File reads are serialized through a promise chain so a burst
// of edits can't interleave; advance() is debounced so one fixpoint covers a
// whole batch of changes.

import { type FSWatcher, watch } from 'chokidar'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Vault } from './vault.js'

export interface WatchHandle {
  /** Resolves once the initial scan has loaded and the first advance ran. */
  ready: Promise<void>
  close(): Promise<void>
}

export function watchVault(
  root: string,
  vault: Vault,
  debounceMs = 50,
): WatchHandle {
  const abs = path.resolve(root)
  const rel = (p: string) => path.relative(abs, p).split(path.sep).join('/')

  let isReady = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<void> = Promise.resolve()

  const scheduleAdvance = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      vault.advance()
    }, debounceMs)
  }

  const queueSet = (p: string, mtimeMs: number) => {
    chain = chain
      .then(async () => {
        const content = await readFile(p, 'utf8')
        vault.setFile(rel(p), content, mtimeMs)
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
        r
          .split(path.sep)
          .some((seg) => seg.startsWith('.') || seg === 'node_modules')
      ) {
        return true
      }
      return !!stats?.isFile() && !p.endsWith('.md')
    },
  })

  watcher.on('add', (p, stats) => queueSet(p, stats?.mtimeMs ?? Date.now()))
  watcher.on('change', (p, stats) => queueSet(p, stats?.mtimeMs ?? Date.now()))
  watcher.on('unlink', (p) => {
    vault.removeFile(rel(p))
    if (isReady) scheduleAdvance()
  })

  const ready = new Promise<void>((resolve) => {
    watcher.on('ready', () => {
      // Drain the initial-scan read chain, then do the first build.
      chain = chain.then(() => {
        vault.advance()
        isReady = true
        resolve()
      })
    })
  })

  return {
    ready,
    async close() {
      if (timer) clearTimeout(timer)
      await watcher.close()
    },
  }
}
