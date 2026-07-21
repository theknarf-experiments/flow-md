import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { CommandBar } from './CommandBar.js'

const meta: Meta<typeof CommandBar> = {
  title: 'CommandBar',
  component: CommandBar,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof CommandBar>

export const NewTab: Story = {
  args: {
    open: true,
    value: '',
    placeholder: 'Search or enter address…',
    hint: 'Opens in a new tab · Esc to dismiss',
  },
}

export const EditingAddress: Story = {
  args: {
    open: true,
    value: 'http://localhost:4748/note/board.mdx',
    placeholder: 'Edit address…',
    hint: 'Navigates this tab · Esc to dismiss',
  },
}

/** Typing and dismissing actually work here. */
export const Interactive: Story = {
  render: () => {
    const [value, setValue] = useState('')
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          open command bar
        </button>
        <CommandBar
          open={open}
          value={value}
          placeholder="Search or enter address…"
          hint="Enter submits · click the backdrop to dismiss"
          onChange={setValue}
          onSubmit={() => setOpen(false)}
          onDismiss={() => setOpen(false)}
        />
      </>
    )
  },
}
