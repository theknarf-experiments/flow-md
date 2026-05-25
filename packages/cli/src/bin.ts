#!/usr/bin/env node
// flow-md CLI: watch a markdown vault and serve its embedded queries.
//
//   flow-md serve [dir] [--port N] [-O level] [--no-sharing]
//
// Turns the directory into a live Datalog notebook: ```datalog blocks become
// rules, ```datalog-query blocks become queries, and the rest of the markdown
// becomes EDB facts. Edits re-evaluate incrementally. All the engine lives in
// @flow-md/server; this package is just the process glue.

import path from 'node:path'
import { Vault, createHttpServer, watchVault } from '@flow-md/server'
import { parseArgs, usage } from './args.js'

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
