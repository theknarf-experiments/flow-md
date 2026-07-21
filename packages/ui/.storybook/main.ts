import type { StorybookConfig } from '@storybook/react-vite'

// A minimal react-only Vite config lives next to this file, matching the
// app's setup — the package itself has no vite.config.ts to inherit.
const config: StorybookConfig = {
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: { viteConfigPath: '.storybook/vite.config.ts' },
    },
  },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
}

export default config
