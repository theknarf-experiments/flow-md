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

export function usage(): void {
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
