#!/usr/bin/env node
// flow-md CLI.
//
//   flow-md serve [dir] [--port N] [-O level] [--no-sharing]
//   flow-md query <datalog> [--port N] [--json]
//   flow-md update <datalog> --row <json> --column <name> --value <v>
//
// `serve` watches a markdown vault and serves its embedded queries; the engine
// lives in @flow-md/server, this package is just the process glue. `query`
// sends a one-off Datalog query to a running server and prints the result.
// `update` edits one cell of a query result; the server traces the edit back
// to its source fact and rewrites the file (see the server's /update docs).

import os from 'node:os'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { type Mount, Vault, createHttpServer, watchVault } from '@flow-md/server'
import { configPlugin } from '@flow-md/plugin-config'
import { csvPlugin } from '@flow-md/plugin-csv'
import { icsPlugin } from '@flow-md/plugin-ics'
import { markdownPlugin, mdxPlugin } from '@flow-md/plugin-markdown'
import { schemaboiPlugin } from '@flow-md/plugin-schemaboi'
import {
  type Args,
  type QueryArgs,
  type UpdateArgs,
  parseArgs,
  parseQueryArgs,
  parseUpdateArgs,
  usage,
} from './args.js'

/** Where flow-md keeps its own config. $XDG_CONFIG_HOME wins, else ~/.config,
 *  both under a flow-md/ dir — the standard spot, and a symlinked keys.vim
 *  there works because the directory is what's watched, not the inode. */
function defaultConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(base, 'flow-md')
}

async function runServe(args: Args): Promise<void> {
  const root = path.resolve(args.dir)
  const vault = new Vault(
    [markdownPlugin, mdxPlugin, icsPlugin, csvPlugin, configPlugin, schemaboiPlugin],
    args.options,
  )

  // The config directory is mounted beside the vault under the `config`
  // prefix, so the keymap file reads as `config/keys.vim` in the engine. Made
  // if absent, because a watcher can't watch a directory that isn't there —
  // and an empty config is a valid one (no overrides). '' means --no-config.
  const mounts: Mount[] = []
  const configDir = args.configDir === '' ? null : path.resolve(args.configDir ?? defaultConfigDir())
  if (configDir) {
    await mkdir(configDir, { recursive: true }).catch(() => undefined)
    mounts.push({ path: configDir, prefix: 'config' })
  }

  const watcher = watchVault([root, ...mounts], vault)
  const server = createHttpServer(vault, root, mounts)

  await watcher.ready
  const queryCount = vault.queries().length
  server.listen(args.port, () => {
    console.log(`flow-md watching ${root}`)
    if (configDir) console.log(`  config    ${configDir}`)
    console.log(`  serving http://localhost:${args.port}  (${queryCount} queries)`)
    if (vault.error()) console.error(`  program error: ${vault.error()}`)
  })

  const shutdown = async () => {
    await watcher.close()
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

interface RunResult {
  error: string | null
  columns: string[]
  rows: (string | number)[][]
}

async function runQuery(args: QueryArgs): Promise<void> {
  const url = `http://localhost:${args.port}/run?q=${encodeURIComponent(args.query)}`
  let body: RunResult
  try {
    const res = await fetch(url)
    body = (await res.json()) as RunResult
  } catch {
    console.error(
      `flow-md: could not reach server at localhost:${args.port} ` +
        '(is `flow-md serve` running?)',
    )
    process.exit(1)
  }
  if (body.error) {
    console.error(`query error: ${body.error}`)
    process.exit(1)
  }
  if (args.json) {
    console.log(JSON.stringify({ columns: body.columns, rows: body.rows }))
    return
  }
  printTable(body.columns, body.rows)
}

interface UpdateResult {
  error: string | null
  path?: string
  oldFact?: { rel: string; row: (string | number)[] }
  newFact?: { rel: string; row: (string | number)[] }
}

async function runUpdate(args: UpdateArgs): Promise<void> {
  let body: UpdateResult
  let status: number
  try {
    const res = await fetch(`http://localhost:${args.port}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        q: args.query,
        row: args.row,
        column: args.column,
        value: args.value,
      }),
    })
    status = res.status
    body = (await res.json()) as UpdateResult
  } catch {
    console.error(
      `flow-md: could not reach server at localhost:${args.port} ` +
        '(is `flow-md serve` running?)',
    )
    process.exit(1)
  }
  if (args.json) {
    console.log(JSON.stringify(body))
    if (status !== 200) process.exit(1)
    return
  }
  if (body.error || status !== 200) {
    console.error(`update error: ${body.error ?? `HTTP ${status}`}`)
    process.exit(1)
  }
  const show = (f: NonNullable<UpdateResult['oldFact']>) =>
    `${f.rel}(${f.row.map((c) => JSON.stringify(c)).join(', ')})`
  console.log(`updated ${body.path}`)
  console.log(`  - ${show(body.oldFact!)}`)
  console.log(`  + ${show(body.newFact!)}`)
}

function printTable(
  columns: string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): void {
  const widths = columns.map((c, i) =>
    rows.reduce((w, r) => Math.max(w, String(r[i] ?? '').length), c.length),
  )
  const line = (cells: ReadonlyArray<string | number>) =>
    columns.map((_, i) => String(cells[i] ?? '').padEnd(widths[i] ?? 0)).join('  ')
  console.log(line(columns))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line(r))
  console.log(`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`)
}

function main(): void {
  const argv = process.argv.slice(2)
  const sub = argv[0]
  if (sub === 'serve') {
    const args = parseArgs(argv)
    if (!args) return fail()
    runServe(args).catch(crash)
  } else if (sub === 'query') {
    const args = parseQueryArgs(argv)
    if (!args) return fail()
    runQuery(args).catch(crash)
  } else if (sub === 'update') {
    const args = parseUpdateArgs(argv)
    if (!args) return fail()
    runUpdate(args).catch(crash)
  } else {
    fail()
  }
}

function fail(): void {
  usage()
  process.exit(1)
}

function crash(err: unknown): void {
  console.error(err)
  process.exit(1)
}

main()
