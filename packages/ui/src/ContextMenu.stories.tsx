import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from './ContextMenu.js'
import { EmojiPicker } from './EmojiPicker.js'
import { HueSwatches } from './HueSwatches.js'
import { SpaceHeader } from './Sidebar.js'
import { useContextMenu } from './useContextMenu.js'

const meta: Meta<typeof ContextMenu> = { title: 'ContextMenu', component: ContextMenu }
export default meta

type Story = StoryObj<typeof ContextMenu>

const HUES = [250, 285, 320, 355, 25, 90, 155, 190]

/** The menu the shell puts on a space: rename it, recolour it, delete it.
 *  Right-click the header. */
export const OnASpaceHeader: Story = {
  render: () => {
    const menu = useContextMenu<string>()
    const [name, setName] = useState('Vault')
    const [hue, setHue] = useState(250)
    const [emoji, setEmoji] = useState('📓')
    const [renaming, setRenaming] = useState(false)
    return (
      <div
        style={{
          width: 240,
          padding: '0.7rem',
          borderRadius: 12,
          color: 'white',
          background: `linear-gradient(150deg, hsl(${hue} 34% 34%), hsl(${hue + 40} 26% 20%))`,
        }}
      >
        <SpaceHeader
          emoji={emoji}
          onContextMenu={(e) => menu.open(e, 'vault')}
          editing={renaming}
          onRename={(next) => {
            setName(next)
            setRenaming(false)
          }}
          onCancelRename={() => setRenaming(false)}
        >
          {name}
        </SpaceHeader>
        {menu.anchor && (
          <ContextMenu x={menu.anchor.x} y={menu.anchor.y} onClose={menu.close}>
            <ContextMenuItem
              onSelect={() => {
                setRenaming(true)
                menu.close()
              }}
            >
              Rename space
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuLabel>Icon</ContextMenuLabel>
            <EmojiPicker
              choices={['📓', '🌐', '🧪', '🎨', '📚', '🎧']}
              value={emoji}
              onSelect={setEmoji}
            />
            <ContextMenuSeparator />
            <ContextMenuLabel>Colour</ContextMenuLabel>
            <HueSwatches hues={HUES} value={hue} onSelect={setHue} />
            <ContextMenuSeparator />
            <ContextMenuItem danger onSelect={menu.close}>
              Delete space
            </ContextMenuItem>
          </ContextMenu>
        )}
      </div>
    )
  },
}

/** Standalone, with a disabled row — the last space can't be deleted. */
export const Items: Story = {
  args: {
    x: 40,
    y: 40,
    onClose: () => {},
    children: (
      <>
        <ContextMenuItem onSelect={() => {}}>Rename space</ContextMenuItem>
        <ContextMenuItem onSelect={() => {}}>Duplicate</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem danger disabled onSelect={() => {}}>
          Delete space
        </ContextMenuItem>
      </>
    ),
  },
}
