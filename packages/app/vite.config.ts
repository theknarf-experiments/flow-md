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
//
// The @flow-md/view-* plugin packages ship TypeScript + CSS-module source
// (no build step), so Vite must transform them like first-party code: keep
// them out of the esbuild prebundle, transform them during SSR/prerender,
// and dedupe react so a plugin's hooks share the app's React instance.
const VIEW_PACKAGES = [
  '@flow-md/view-api',
  '@flow-md/view-kanban',
  '@flow-md/view-graph',
]

export default defineConfig({
  plugins: [
    tanstackStart({
      spa: { enabled: true },
    }),
    react(),
  ],
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { exclude: VIEW_PACKAGES },
  ssr: { noExternal: VIEW_PACKAGES },
})
