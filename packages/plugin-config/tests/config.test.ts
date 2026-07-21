import type { Fact } from '@flow-md/plugin-api'
import { describe, expect, it } from 'vitest'
import {
  chordToKeys,
  deleteConfigFact,
  insertConfigFact,
  keysToChord,
  parseConfig,
  parseVim,
} from '../src/index.js'

const FILE = [
  '" flow-md hotkeys',
  'map <C-j> next-tab',
  'map <D-t> new-tab',
  'map gg scroll-top',
  'unmap <C-k>',
  '',
].join('\n')

const rows = (facts: Fact[], rel: string) => facts.filter((f) => f.rel === rel).map((f) => f.row)

describe('keysToChord', () => {
  it('reads vim modifier notation', () => {
    expect(keysToChord('<C-j>')).toBe('Ctrl+J')
    expect(keysToChord('<D-t>')).toBe('Mod+T')
    expect(keysToChord('<S-g>')).toBe('Shift+G')
    expect(keysToChord('<C-S-k>')).toBe('Ctrl+Shift+K')
  })

  it('reads a bare sequence as space-separated steps', () => {
    expect(keysToChord('gg')).toBe('G G')
  })

  it('names the special keys', () => {
    expect(keysToChord('<CR>')).toBe('Enter')
    expect(keysToChord('<C-Space>')).toBe('Ctrl+Space')
  })
})

describe('chordToKeys round-trips', () => {
  for (const chord of ['Ctrl+J', 'Mod+T', 'Shift+G', 'G G', 'Ctrl+Shift+K']) {
    it(chord, () => {
      expect(keysToChord(chordToKeys(chord))).toBe(chord)
    })
  }
})

describe('parseVim', () => {
  it('skips comments and blanks, reads maps and unmaps', () => {
    const b = parseVim(FILE)
    expect(b.map((x) => [x.keys, x.action, x.unmap])).toEqual([
      ['Ctrl+J', 'next-tab', false],
      ['Mod+T', 'new-tab', false],
      ['G G', 'scroll-top', false],
      ['Ctrl+K', '', true],
    ])
  })

  it('carries the line each binding sits on', () => {
    expect(parseVim(FILE).map((b) => b.line)).toEqual([2, 3, 4, 5])
  })

  it('skips a map with no action', () => {
    expect(parseVim('map <C-j>')).toEqual([])
  })
})

describe('parseConfig', () => {
  it('emits Keymap and Unmap facts', () => {
    const { facts } = parseConfig('keys.vim', FILE, 0)
    expect(rows(facts, 'Keymap')).toEqual([
      ['keys.vim', 'next-tab', 'Ctrl+J', 2],
      ['keys.vim', 'new-tab', 'Mod+T', 3],
      ['keys.vim', 'scroll-top', 'G G', 4],
    ])
    expect(rows(facts, 'Unmap')).toEqual([['keys.vim', 'Ctrl+K', 5]])
  })
})

describe('write-back', () => {
  const cell = (action: string, keys: string): Fact => ({
    rel: 'Keymap',
    row: ['keys.vim', action, keys, 0],
  })

  it('rewrites the line for an action already bound', () => {
    const out = insertConfigFact(FILE, cell('next-tab', 'Ctrl+N'))
    expect(out.split('\n')[1]).toBe('map <C-n> next-tab')
    // Nothing else moved.
    expect(out.split('\n')[2]).toBe('map <D-t> new-tab')
  })

  it('appends a binding for an action not yet in the file', () => {
    const out = insertConfigFact(FILE, cell('close-tab', 'Mod+W'))
    expect(out.trimEnd().split('\n').pop()).toBe('map <D-w> close-tab')
    // And it reads back as the fact that was asked for.
    expect(rows(parseConfig('keys.vim', out, 0).facts, 'Keymap')).toContainEqual([
      'keys.vim',
      'close-tab',
      'Mod+W',
      6,
    ])
  })

  it('removes a binding so the default comes back', () => {
    const out = deleteConfigFact(FILE, cell('new-tab', 'Mod+T'))
    expect(out).not.toContain('new-tab')
    expect(out).toContain('next-tab')
  })
})
