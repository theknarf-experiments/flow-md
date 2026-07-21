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
