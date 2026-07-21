import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Portable-story tests render real stories, including ones from the view
// packages, so they need JSX compiled and the DOM.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
})
