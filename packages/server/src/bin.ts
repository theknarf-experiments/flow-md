#!/usr/bin/env node
// flow-md CLI: watch a markdown vault and serve its embedded queries.
//
//   flow-md serve [dir] [--port N] [-O level] [--no-sharing]
//
// Turns the directory into a live Datalog notebook: ```datalog blocks become
// rules, ```datalog-query blocks become queries, and the rest of the markdown
// becomes EDB facts. Edits re-evaluate incrementally.

import path from 'node:path'
import { Vault, type VaultOptions } from './vault.js'
import { createHttpServer } from './server.js'
import { watchVault } from './watcher.js'

interface Args {
  dir: string
  port: number
  options: VaultOptions
}

function parseArgs(argv: string[]): Args | null {
  if (argv[0] !== 'serve') return null
  const args: Args = { dir: '.', port: 4747, options: {} }
  let sawDir = false
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--port' || a === '-p') {
      args.port = Number(argv[++i])
    } else if (a === '-O') {
      args.options.optLevel = Number(argv[++i])
    } else if (a === '--no-sharing') {
      args.options.noSharing = true
    } else if (!a.startsWith('-') && !sawDir) {
      args.dir = a
      sawDir = true
    } else {
      console.error(`unknown argument: ${a}`)
      return null
    }
  }
  return args
}

function usage(): void {
  console.error(
    [
      'Usage: flow-md serve [dir] [options]',
      '',
      '  Watch a markdown vault and serve its embedded Datalog queries.',
      '',
      'Options:',
      '  -p, --port <n>   HTTP port (default 4747)',
      '  -O <level>       optimizer level: 0=as-is, 1=sip, 2=planning, 3=both',
      '  --no-sharing     disable transformation-output sharing',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    usage()
    process.exit(1)
  }

  const root = path.resolve(args.dir)
  const vault = new Vault(args.options)
  const watcher = watchVault(root, vault)
  const server = createHttpServer(vault, root)

  await watcher.ready
  const queryCount = vault.queries().length
  server.listen(args.port, () => {
    console.log(`flow-md watching ${root}`)
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
