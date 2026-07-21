import { defineConfig } from 'vite'

// Port matches the launcher's default (--install-isolated-web-app-from-url).
//
// COOP/COEP make the dev server match the real thing: IWAs are required to be
// cross-origin isolated, so Chrome enforces it once installed. Better to hit
// any fallout here than after packaging.
//
// Deliberately no @vitejs/plugin-react: it injects an *inline* Fast Refresh
// preamble, and an IWA's `script-src 'self'` blocks inline script — the app
// then dies on a missing $RefreshReg$. Vite's esbuild already compiles .tsx
// using tsconfig's `jsx: react-jsx`, so all we give up is Fast Refresh (HMR
// still reloads), and the page stays CSP-clean in dev and prod alike.
export default defineConfig({
  // @flow-md/ui ships raw TS + CSS Modules (no build step), so Vite has to
  // transform it like first-party code, and react must be deduped or the
  // library's hooks would run against a second copy.
  //
  // react is pre-bundled explicitly as well: dedupe only governs resolution,
  // not the dep optimizer, so a prebundled dependency that imports react (any
  // hook library) otherwise gets its own copy of it and every hook it calls
  // finds a null dispatcher.
  optimizeDeps: {
    exclude: ['@flow-md/ui'],
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  },
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5193,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    port: 5193,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
