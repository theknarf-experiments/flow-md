import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Storybook only. The shell deliberately avoids plugin-react (its inline Fast
// Refresh preamble violates the IWA CSP), but Storybook is a plain dev server
// with no such constraint, so Fast Refresh is welcome here.
export default defineConfig({
  plugins: [react()],
})
