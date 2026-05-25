import { describe, expect, it } from 'vitest'
import { parseArgs, parseQueryArgs } from '../src/args.js'

describe('parseArgs', () => {
  it('defaults dir to "." and port to 4747', () => {
    expect(parseArgs(['serve'])).toEqual({ dir: '.', port: 4747, options: {} })
  })

  it('parses a directory and --port', () => {
    expect(parseArgs(['serve', 'docs', '--port', '8080'])).toEqual({
      dir: 'docs',
      port: 8080,
      options: {},
    })
  })

  it('parses optimizer and sharing flags', () => {
    expect(parseArgs(['serve', '-O', '2', '--no-sharing'])).toEqual({
      dir: '.',
      port: 4747,
      options: { optLevel: 2, noSharing: true },
    })
  })

  it('returns null without the serve subcommand or on unknown flags', () => {
    expect(parseArgs([])).toBeNull()
    expect(parseArgs(['nope'])).toBeNull()
    expect(parseArgs(['serve', '--bogus'])).toBeNull()
  })
})

describe('parseQueryArgs', () => {
  it('parses a query string with defaults', () => {
    expect(parseQueryArgs(['query', 'Foo(x)'])).toEqual({
      query: 'Foo(x)',
      port: 4747,
      json: false,
    })
  })

  it('parses --port and --json', () => {
    expect(parseQueryArgs(['query', 'Foo(x)', '--port', '9000', '--json'])).toEqual({
      query: 'Foo(x)',
      port: 9000,
      json: true,
    })
  })

  it('returns null without the query subcommand or a query string', () => {
    expect(parseQueryArgs(['serve'])).toBeNull()
    expect(parseQueryArgs(['query'])).toBeNull()
    expect(parseQueryArgs(['query', '--json'])).toBeNull()
  })
})
