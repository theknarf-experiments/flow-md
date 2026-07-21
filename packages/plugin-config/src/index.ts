// The config plugin: claims flow-md's vim-flavoured keymap file and turns each
// binding into facts, so the shell can read its hotkey overrides out of the
// engine the same way it reads everything else.
//
// Schema (File is shared with the other plugins):
//   Keymap(path, action, keys, line)   a rebind: this action uses these keys
//   Unmap(path, keys, line)            a default turned off
//
// The file holds only what the user changed — an action they never touched
// isn't in it, and keeps its built-in key. Write-back appends or rewrites one
// `map` line, leaving the rest of the file (comments included) byte-for-byte.

import type { Fact, ParseResult, Plugin, WritableRel } from '@flow-md/plugin-api'
import { type Binding, chordToKeys, parseVim } from './vim.js'

/** The file flow-md keeps its keymap in, relative to the config root. */
export const KEYMAP_FILE = 'keys.vim'

export const CONFIG_SCHEMA = [
  { name: 'File', attrs: [['path', 'string'], ['mtime', 'number']] as [string, 'string' | 'number'][] },
  {
    name: 'Keymap',
    attrs: [
      ['path', 'string'],
      ['action', 'string'],
      ['keys', 'string'],
      ['line', 'number'],
    ] as [string, 'string' | 'number'][],
  },
  {
    name: 'Unmap',
    attrs: [
      ['path', 'string'],
      ['keys', 'string'],
      ['line', 'number'],
    ] as [string, 'string' | 'number'][],
  },
]

// No writable `cols`: a rebind isn't an in-place cell edit but a whole `map`
// line rewritten (or removed) by action, so it's expressed as insert/delete
// rather than update. Empty cols keeps the validator happy — it requires an
// updateFact only when a column is declared editable.
export const CONFIG_WRITABLE: WritableRel[] = [
  { rel: 'Keymap', cols: [], canInsert: true, canDelete: true, pathAttr: 'path' },
]

export function parseConfig(path: string, content: string, mtime: number): ParseResult {
  const facts: Fact[] = [{ rel: 'File', row: [path, mtime] }]
  for (const b of parseVim(content)) {
    if (b.unmap) facts.push({ rel: 'Unmap', row: [path, b.keys, b.line] })
    else facts.push({ rel: 'Keymap', row: [path, b.action, b.keys, b.line] })
  }
  return { facts, rules: [], queries: [] }
}

/** Render one binding as a `map` line. Used by both insert and rewrite. */
function mapLine(action: string, keys: string): string {
  return `map ${chordToKeys(keys)} ${action}`
}

/** Add a rebind. A binding for an action that isn't in the file yet is
 *  appended; the reparse settles its line. The action is the identity — one
 *  action has one key — so an existing binding for it is rewritten in place
 *  rather than duplicated. */
export function insertConfigFact(content: string, fact: Fact): string {
  if (fact.rel !== 'Keymap') {
    throw new Error(`relation "${fact.rel}" is not insertable by the config plugin`)
  }
  const [, action, keys] = fact.row as [string, string, string, number]
  const existing = parseVim(content).find((b) => !b.unmap && b.action === action)
  const line = mapLine(String(action), String(keys))
  const lines = content.split('\n')
  if (existing) {
    lines[existing.line - 1] = line
    return lines.join('\n')
  }
  if (lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, line)
  else lines.push(line)
  return lines.join('\n')
}

/** Remove a rebind, so the action falls back to its default. */
export function deleteConfigFact(content: string, fact: Fact): string {
  if (fact.rel !== 'Keymap') {
    throw new Error(`relation "${fact.rel}" is not deletable by the config plugin`)
  }
  const [, action] = fact.row as [string, string, string, number]
  const found = parseVim(content).find((b: Binding) => !b.unmap && b.action === action)
  if (!found) throw new Error(`no binding for action "${action}"`)
  const lines = content.split('\n')
  lines.splice(found.line - 1, 1)
  return lines.join('\n')
}

export const configPlugin: Plugin = {
  name: 'config',
  extensions: ['.vim'],
  schema: CONFIG_SCHEMA,
  parse: parseConfig,
  writable: CONFIG_WRITABLE,
  insertFact: insertConfigFact,
  deleteFact: deleteConfigFact,
}

export { parseVim, keysToChord, chordToKeys } from './vim.js'
export type { Binding } from './vim.js'
export default configPlugin
