// Separate from vite.config.ts on purpose: vitest must not load the Tanstack
// Start plugin (it expects a full app build context). The unit tests cover
// pure modules only, so no plugins are needed at all.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
