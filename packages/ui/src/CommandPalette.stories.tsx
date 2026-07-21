import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { CommandPalette, type PaletteItem } from './CommandPalette.js'

const meta: Meta<typeof CommandPalette> = {
  title: 'CommandPalette',
  component: CommandPalette,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onQueryChange: () => {}, onDismiss: () => {} },
}
export default meta

type Story = StoryObj<typeof CommandPalette>

const ITEMS: PaletteItem[] = [
  { key: 'c1', icon: '⌘', label: 'New note', run: () => {} },
  { key: 'c2', icon: '⌘', label: 'Toggle dark/light theme', run: () => {} },
  { key: 'f1', icon: '📝', label: 'tasks.md', run: () => {} },
  { key: 'f2', icon: '🧩', label: 'board.mdx', run: () => {} },
  { key: 'f3', icon: '📦', label: 'contacts.sb', run: () => {} },
  {
    key: 't1',
    icon: '📝',
    label: 'roadmap.md',
    detail: '- [ ] Incremental fact updates on content edits',
    run: () => {},
  },
]

/** The app's ⌘K: commands, file matches, and content hits with a detail line. */
export const WithResults: Story = {
  args: { query: 'ta', items: ITEMS, placeholder: 'Search files, content and commands…' },
}

export const NoMatches: Story = {
  args: { query: 'zzzz', items: [], placeholder: 'Search files, content and commands…' },
}

/** The shell's address bar: no items, so Enter submits the raw text. Same
 *  component — the two only ever differed in whether results were passed. */
export const AsAddressBar: Story = {
  args: {
    query: 'localhost:4748/note/board.mdx',
    placeholder: 'Search or enter address…',
    hint: 'Navigates this tab · Esc to dismiss',
  },
}

/** Typing, arrow keys and dismissal all work here. */
export const Interactive: Story = {
  render: () => {
    const [query, setQuery] = useState('')
    const [open, setOpen] = useState(true)
    const [last, setLast] = useState('—')
    const items = ITEMS.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())).map(
      (i) => ({ ...i, run: () => { setLast(i.label); setOpen(false) } }),
    )
    return (
      <div style={{ padding: '1rem' }}>
        <button type="button" onClick={() => setOpen(true)}>
          open palette
        </button>
        <p>last chosen: {last}</p>
        <CommandPalette
          open={open}
          query={query}
          items={items}
          placeholder="Search…"
          onQueryChange={setQuery}
          onDismiss={() => setOpen(false)}
        />
      </div>
    )
  },
}
