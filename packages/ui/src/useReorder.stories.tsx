import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Tab } from './Tab.js'
import { useReorder } from './useReorder.js'

const meta: Meta = { title: 'useReorder' }
export default meta

type Story = StoryObj

/** Drag a row onto another to move it there. Which half of the target you're
 *  over decides whether it lands above or below — dropping on the lower half
 *  of the last row is the only way to reach the end of a list. */
export const Reordering: Story = {
  render: () => {
    const [rows, setRows] = useState([
      { id: 'a', label: 'Example Domain' },
      { id: 'b', label: 'Controlled Frame' },
      { id: 'c', label: 'Hacker News' },
      { id: 'd', label: 'MDN' },
    ])
    const reorder = useReorder<string>(
      (id, before) => {
        setRows((current) => {
          const moving = current.find((r) => r.id === id)
          if (!moving) return current
          const rest = current.filter((r) => r.id !== id)
          const at = before ? rest.findIndex((r) => r.id === before) : rest.length
          return [...rest.slice(0, at), moving, ...rest.slice(at)]
        })
      },
      rows.map((r) => r.id),
    )
    return (
      <div style={{ width: 240, color: 'white' }}>
        {rows.map((row) => (
          <Tab key={row.id} label={row.label} drag={reorder.row(row.id)} onClose={() => {}} />
        ))}
      </div>
    )
  },
}
