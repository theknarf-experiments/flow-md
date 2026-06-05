// Plugin registry: maps file extensions to the plugin that owns them, and
// exposes the file extensions the watcher should listen for. Conflicts (two
// plugins claiming the same extension) are rejected up front.

import type { Plugin } from '@flow-md/plugin-api'
import path from 'node:path'

export class PluginRegistry {
  private readonly byExt = new Map<string, Plugin>()
  readonly plugins: readonly Plugin[]

  constructor(plugins: readonly Plugin[]) {
    this.plugins = plugins
    for (const p of plugins) {
      for (const rawExt of p.extensions) {
        const ext = rawExt.toLowerCase()
        const prev = this.byExt.get(ext)
        if (prev) {
          throw new Error(
            `plugins "${prev.name}" and "${p.name}" both claim extension "${ext}"`,
          )
        }
        this.byExt.set(ext, p)
      }
    }
  }

  /** Plugin that owns the file at `filePath`, or null if none claim it. */
  pluginFor(filePath: string): Plugin | null {
    const ext = path.extname(filePath).toLowerCase()
    return this.byExt.get(ext) ?? null
  }

  /** Lower-case extensions (including the leading dot) the watcher watches. */
  extensions(): string[] {
    return [...this.byExt.keys()]
  }
}
