import type { StorybookConfig } from '@storybook/react-vite'

// The one Storybook in the monorepo. It globs sibling packages too, so a
// story can live next to the component it documents — the view plugins own
// their own stories rather than having them stranded in whichever package
// happened to host Storybook.
//
// A minimal react-only Vite config lives next to this file; the package
// itself has no vite.config.ts to inherit.
const config: StorybookConfig = {
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: { viteConfigPath: '.storybook/vite.config.ts' },
    },
  },
  stories: [
    '../src/**/*.stories.@(ts|tsx)',
    '../../view-*/src/**/*.stories.@(ts|tsx)',
  ],
}

export default config
