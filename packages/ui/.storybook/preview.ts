import type { Preview } from '@storybook/react-vite'
import './theme.css'

// These components carry no colours of their own — they inherit the theme
// variables. The backgrounds picker doubles as a surface switcher so you can
// check each one on the shell's gradient as well as a flat panel.
const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        panel: { name: 'panel', value: '#242424' },
        gradient: { name: 'gradient', value: '#3b2a7a' },
        light: { name: 'light', value: '#fcfcfc' },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'panel' },
  },
  decorators: [
    (Story, ctx) => {
      const bg = (ctx.globals as { backgrounds?: { value?: string } }).backgrounds?.value
      document.documentElement.dataset.surface = bg ?? 'panel'
      return Story()
    },
  ],
}

export default preview
