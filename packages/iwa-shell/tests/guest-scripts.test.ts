import { describe, expect, it } from 'vitest'
import { GUEST_SCRIPTS } from '../src/lib/frames.js'

describe('the scripts the shell injects into guests', () => {
  for (const [name, code] of Object.entries(GUEST_SCRIPTS)) {
    it(`${name} parses as JavaScript`, () => {
      // What a guest does with the string: parse it. A template literal eats
      // one level of backslashes on the way here, so an escape written for the
      // guest and not doubled arrives broken — this is where that shows up.
      expect(() => new Function(code)).not.toThrow()
    })
  }
})
