import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        app: { name: 'app', value: '#1e1e23' },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'app' },
  },
}

export default preview
