import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tanstack Start in SPA mode, mirroring vendor/flow-ts/packages/example-web.
// The app is a pure client of a running `flow-md serve` — all vault state
// lives in that process, so there is nothing to SSR here.
//
// Note: no standalone `@tanstack/router-plugin/vite` — Start bundles its own
// router plugin, and doubling it runs the code-splitter twice (see the
// example-web config for the war story).
export default defineConfig({
  plugins: [
    tanstackStart({
      spa: { enabled: true },
    }),
    react(),
  ],
})
