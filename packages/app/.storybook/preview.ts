import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

// The background picker doubles as the theme switch: picking a background
// also sets <html data-theme>, so components render with the matching
// palette variables (same mechanism as the app's toggle).
const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        dark: { name: 'dark', value: '#1a1a1a' },
        light: { name: 'light', value: '#fcfcfc' },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'dark' },
  },
  decorators: [
    (Story, ctx) => {
      const bg = (ctx.globals as { backgrounds?: { value?: string } }).backgrounds?.value
      document.documentElement.setAttribute(
        'data-theme',
        bg === 'light' ? 'light' : 'dark',
      )
      return Story()
    },
  ],
}

export default preview
