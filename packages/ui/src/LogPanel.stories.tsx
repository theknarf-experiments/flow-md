import type { Meta, StoryObj } from '@storybook/react-vite'
import { LogPanel } from './LogPanel.js'

const meta: Meta<typeof LogPanel> = {
  title: 'LogPanel',
  component: LogPanel,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof LogPanel>

/** The shell's real output: CSP probes, frame lifecycle, captures. */
export const Default: Story = {
  args: {
    lines: [
      { text: 'capture → {"title":"flow-md","bytes":25099}', tone: 'ok' },
      { text: 'tab 2 → https://example.com' },
      { text: 'tab 1 → http://localhost:4748/' },
      { text: 'controlledframe: HTMLControlledFrameElement', tone: 'ok' },
      { text: 'csp AsyncFunction: blocked (EvalError)', tone: 'ok' },
      { text: 'csp new Function: blocked (EvalError)', tone: 'ok' },
    ],
  },
}

export const WithError: Story = {
  args: {
    lines: [
      { text: 'controlledframe MISSING — unknown element', tone: 'err' },
      { text: 'falling back to <iframe>' },
    ],
  },
}

export const Empty: Story = { args: { lines: [] } }
