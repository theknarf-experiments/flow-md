import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { EmojiPicker } from './EmojiPicker.js'

const meta: Meta<typeof EmojiPicker> = { title: 'EmojiPicker', component: EmojiPicker }
export default meta

type Story = StoryObj<typeof EmojiPicker>

const CHOICES = ['📓', '🌐', '🧪', '🎨', '📚', '🎧', '🛠️', '🌱', '🔭', '💼', '🎮', '📮']

/** The grid covers the common cases; the field takes anything else, including
 *  whatever the system picker inserts. */
export const Default: Story = {
  render: () => {
    const [emoji, setEmoji] = useState('🧪')
    return (
      <div style={{ width: 190, background: 'rgba(32,30,40,0.97)', color: 'white', padding: '0.3rem', borderRadius: 10 }}>
        <EmojiPicker choices={CHOICES} value={emoji} onSelect={setEmoji} />
        <p style={{ padding: '0 0.5rem', fontSize: '0.75rem', opacity: 0.7 }}>Picked: {emoji}</p>
      </div>
    )
  },
}
