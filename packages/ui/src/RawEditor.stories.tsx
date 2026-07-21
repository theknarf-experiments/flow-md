import type { Meta, StoryObj } from '@storybook/react-vite'
import { RawEditor } from './RawEditor.js'

const meta: Meta<typeof RawEditor> = {
  title: 'RawEditor',
  component: RawEditor,
  args: { onSave: async () => {} },
}
export default meta

type Story = StoryObj<typeof RawEditor>

const NOTE = `---
title: Tasks
tags: [example]
---

# Tasks

- [ ] water the plants
- [x] ship the release

\`\`\`datalog-query
Task(path, status, text, line)
\`\`\`
`

/** Type to see the bar switch to "unsaved changes"; ⌘S saves. */
export const Default: Story = { args: { initial: NOTE } }

export const Empty: Story = { args: { initial: '' } }

/** A rejected save surfaces the reason and leaves the draft alone, so
 *  nothing is lost. */
export const SaveFails: Story = {
  args: {
    initial: NOTE,
    onSave: async () => {
      throw new Error('the file changed and no longer contains the fact being updated')
    },
  },
}

/** Saves aren't instant in practice — this one takes a beat, so the bar
 *  shows "saving". */
export const SlowSave: Story = {
  args: {
    initial: NOTE,
    onSave: () => new Promise((resolve) => setTimeout(resolve, 2000)),
  },
}
