import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from './Banner.js'

const meta: Meta<typeof Banner> = {
  title: 'Banner',
  component: Banner,
}
export default meta

type Story = StoryObj<typeof Banner>

export const Warn: Story = {
  args: { children: 'Storybook is showing cached data — the server is unreachable.' },
}

/** What the shell shows when it isn't running as an Isolated Web App. */
export const Error_: Story = {
  name: 'Error',
  args: {
    tone: 'error',
    children: '<controlledframe> unavailable — unknown element · run: mise run iwa',
  },
}

export const Info: Story = {
  args: { tone: 'info', children: 'Read-only: this vault was opened without a server.' },
}

/** Multi-line messages keep their line breaks. */
export const Multiline: Story = {
  args: {
    tone: 'error',
    children:
      '<controlledframe> unavailable — unknown element (HTMLUnknownElement)\nFalling back to <iframe>; most sites will refuse to load.',
  },
}
