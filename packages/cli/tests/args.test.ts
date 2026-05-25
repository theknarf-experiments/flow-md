import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/args.js'

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
