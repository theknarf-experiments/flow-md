import { describe, expect, it } from 'vitest'
import { type Dismissal, dismissalSpent } from '../src/lib/pip.js'

/** A video sent away, still playing, still off screen. */
const dismissed: Dismissal = {
  hidden: 'space\n01A',
  firstId: 'space\n01B',
  splitId: null,
  mediaId: 'space\n01A',
  exists: true,
}

describe('a dismissed picture-in-picture corner', () => {
  it('stays away while it is still the thing playing', () => {
    expect(dismissalSpent(dismissed)).toBe(false)
  })

  it('stays away when that video is paused', () => {
    // The bug this file exists for. Nothing about pausing appears in the rule,
    // so there is nothing here to pass — which is the point: a paused video is
    // the same video, and ✕ meant "not this one".
    expect(dismissalSpent(dismissed)).toBe(false)
  })

  it('comes back when you return to the tab', () => {
    expect(dismissalSpent({ ...dismissed, firstId: dismissed.hidden })).toBe(true)
    expect(dismissalSpent({ ...dismissed, splitId: dismissed.hidden })).toBe(true)
  })

  it('comes back when the tab is closed', () => {
    expect(dismissalSpent({ ...dismissed, exists: false })).toBe(true)
  })

  it('comes back when something else starts playing', () => {
    expect(dismissalSpent({ ...dismissed, mediaId: 'space\n01C' })).toBe(true)
  })

  it('comes back once nothing is playing at all', () => {
    // The next video to start is a new corner, and shouldn't inherit a
    // dismissal aimed at the last one.
    expect(dismissalSpent({ ...dismissed, mediaId: null })).toBe(true)
  })
})
