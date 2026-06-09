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

export interface UpdateArgs {
  query: string
  row: Array<string | number>
  column: string
  value: string
  port: number
  json: boolean
}

/** Parse `update <datalog> --row <json> --column <name> --value <v>` — edit
 *  one cell of a query result on a running server, writing back to source. */
export function parseUpdateArgs(argv: string[]): UpdateArgs | null {
  if (argv[0] !== 'update') return null
  let query: string | null = null
  let row: Array<string | number> | null = null
  let column: string | null = null
  let value: string | null = null
  let port = 4747
  let json = false
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--port' || a === '-p') {
      port = Number(argv[++i])
    } else if (a === '--row') {
      const raw = argv[++i]
      try {
        const parsed: unknown = JSON.parse(raw ?? '')
        if (
          !Array.isArray(parsed) ||
          !parsed.every((c) => typeof c === 'string' || typeof c === 'number')
        ) {
          throw new Error('not a flat array')
        }
        row = parsed
      } catch {
        console.error('update: --row must be a JSON array of strings/numbers')
        return null
      }
    } else if (a === '--column') {
      column = argv[++i] ?? null
    } else if (a === '--value') {
      value = argv[++i] ?? null
    } else if (a === '--json') {
      json = true
    } else if (!a.startsWith('-') && query === null) {
      query = a
    } else {
      console.error(`unknown argument: ${a}`)
      return null
    }
  }
  if (query === null || row === null || column === null || value === null) {
    console.error('update: needs <datalog>, --row, --column and --value')
    return null
  }
  return { query, row, column, value, port, json }
}

export function usage(): void {
  console.error(
    [
      'Usage: flow-md <command> [options]',
      '',
      'Commands:',
      '  serve [dir]       watch a vault and serve its embedded queries over HTTP',
      '  query <datalog>   run a one-off query against a running server',
      '  update <datalog>  edit one cell of a query result; the change is',
      '                    written back into the source file',
      '',
      'serve options:',
      '  -p, --port <n>   HTTP port (default 4747)',
      '  -O <level>       optimizer level: 0=as-is, 1=sip, 2=planning, 3=both',
      '  --no-sharing     disable transformation-output sharing',
      '',
      'query options:',
      '  -p, --port <n>   port of the running server (default 4747)',
      '  --json           print results as JSON instead of a table',
      '',
      'update options:',
      "  --row <json>     the result row being edited, e.g. '[\"a.md\",\"open\",\"x\",3]'",
      '  --column <name>  the column to change',
      '  --value <v>      the new value',
      '  -p, --port <n>   port of the running server (default 4747)',
      '  --json           print the server response as JSON',
    ].join('\n'),
  )
}
