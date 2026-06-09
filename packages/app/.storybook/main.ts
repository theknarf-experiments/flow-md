import type { StorybookConfig } from '@storybook/react-vite'

// Storybook must NOT load the app's vite.config.ts — the Tanstack Start
// plugin in there expects a full app build (routes, SPA shell) and breaks
// under Storybook's dev server. A minimal react-only config lives next to
// this file instead.
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
