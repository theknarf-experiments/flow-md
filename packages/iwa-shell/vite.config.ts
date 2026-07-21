import { defineConfig } from 'vite'

// Port matches the launcher's default (--install-isolated-web-app-from-url).
//
// The COOP/COEP headers make the dev server match the real thing: IWAs are
// required to be cross-origin isolated, so Chrome will enforce it once
// installed. Better to hit any fallout here than after packaging.
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
