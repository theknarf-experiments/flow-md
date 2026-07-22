import { defineConfig } from 'vitest/config'

// frames.ts reaches for `document` as it loads, to work out whether this
// browser has <controlledframe> at all — so importing it needs a DOM even
// though these tests only read strings out of it.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'jsdom' },
})
