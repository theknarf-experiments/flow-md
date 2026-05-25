// Argument parsing for the flow-md CLI, kept separate from the runner so it
// can be unit-tested without spawning a process.

import type { VaultOptions } from '@flow-md/server'

export interface Args {
  dir: string
  port: number
  options: VaultOptions
}

/** Parse `serve [dir] [options]`. Returns null on an unrecognized invocation
 *  (the caller prints usage and exits). */
export function parseArgs(argv: string[]): Args | null {
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

export interface QueryArgs {
  query: string
  port: number
  json: boolean
}

/** Parse `query <datalog> [options]` — a one-off query for a running server. */
export function parseQueryArgs(argv: string[]): QueryArgs | null {
  if (argv[0] !== 'query') return null
  let query: string | null = null
  let port = 4747
  let json = false
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--port' || a === '-p') {
      port = Number(argv[++i])
    } else if (a === '--json') {
      json = true
    } else if (!a.startsWith('-') && query === null) {
      query = a
    } else {
      console.error(`unknown argument: ${a}`)
      return null
    }
  }
  if (query === null) {
    console.error('query: missing query string')
    return null
  }
  return { query, port, json }
}

export function usage(): void {
  console.error(
    [
      'Usage: flow-md <command> [options]',
      '',
      'Commands:',
      '  serve [dir]      watch a vault and serve its embedded queries over HTTP',
      '  query <datalog>  run a one-off query against a running server',
      '',
      'serve options:',
      '  -p, --port <n>   HTTP port (default 4747)',
      '  -O <level>       optimizer level: 0=as-is, 1=sip, 2=planning, 3=both',
      '  --no-sharing     disable transformation-output sharing',
      '',
      'query options:',
      '  -p, --port <n>   port of the running server (default 4747)',
      '  --json           print results as JSON instead of a table',
    ].join('\n'),
  )
}
