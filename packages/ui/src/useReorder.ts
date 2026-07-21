import { type DragEvent, useCallback, useState } from 'react'

export interface Drop<T> {
  /** The row it should sit before, or null for last. */
  before: T | null
  /** How deep, when the list is a tree. Taken from how far right the cursor
   *  was: an outliner's gesture, and the only one that can express "make this
   *  a child" without a second control. */
  depth: number
}

export interface ReorderHandlers<T extends string | number> {
  /** Props for a row: makes it draggable and a drop target. */
  row: (id: T) => Record<string, unknown>
  /** The row being dragged, or null. */
  dragging: T | null
}

/** Drag a row onto another to move it there.
 *
 *  HTML5 drag and drop rather than pointer maths: it gives the cursor, the
 *  escape key and the drop animation for nothing, and a list of rows is
 *  exactly what it was designed for.
 *
 *  Which half of the target you're over decides whether the row lands before
 *  or after it, which is the difference between "move to the end" and "move
 *  to the last position" — and the only way to reach the far end of a list. */
export function useReorder<T extends string | number>(
  onMove: (id: T, drop: Drop<T>) => void,
  order: readonly T[],
  options: {
    /** Pixels of indent per level, for reading depth off the cursor. */
    step?: number
    /** Depth of a row, so a drop can't be more than one level deeper than
     *  what it lands under. */
    depthOf?: (id: T) => number
  } = {},
): ReorderHandlers<T> {
  const { step = 14, depthOf } = options
  const [dragging, setDragging] = useState<T | null>(null)
  const [over, setOver] = useState<{ id: T; after: boolean; depth: number } | null>(null)

  const row = useCallback(
    (id: T) => {
      const isOver = over?.id === id && dragging !== null && dragging !== id
      return {
        draggable: true as const,
        onDragStart: (e: DragEvent) => {
          setDragging(id)
          // Firefox won't start a drag without data on it.
          e.dataTransfer.setData('text/plain', String(id))
          e.dataTransfer.effectAllowed = 'move'
        },
        onDragOver: (e: DragEvent) => {
          if (dragging === null || dragging === id) return
          // Without this the drop never fires: the default is "reject".
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const box = e.currentTarget.getBoundingClientRect()
          const after = e.clientY > box.top + box.height / 2
          // How far right the cursor is, in levels — capped at one deeper
          // than the row it's landing under, since a list can't skip a level.
          const asked = Math.max(0, Math.round((e.clientX - box.left) / step))
          const under = depthOf?.(id) ?? 0
          setOver({ id, after, depth: Math.min(asked, under + (after ? 1 : 0)) })
        },
        onDragLeave: () => setOver((o) => (o?.id === id ? null : o)),
        onDrop: (e: DragEvent) => {
          e.preventDefault()
          const moved = dragging
          const target = over
          setDragging(null)
          setOver(null)
          if (moved === null || target === null || moved === target.id) return
          // "Before which row" is what a list can act on; the row after the
          // one you dropped onto, or nothing when it's the last.
          const at = order.indexOf(target.id)
          const before = target.after ? (order[at + 1] ?? null) : target.id
          if (before === moved) return
          onMove(moved, { before, depth: target.depth })
        },
        onDragEnd: () => {
          setDragging(null)
          setOver(null)
        },
        ...(dragging === id ? { 'data-dragging': true } : {}),
        ...(isOver ? { 'data-drop': over.after ? ('after' as const) : ('before' as const) } : {}),
        // The line is drawn where the row would land, not at the left edge —
        // that's what shows you which level you're dropping into.
        ...(isOver ? { style: { '--drop-indent': `${over.depth * step}px` } } : {}),
      }
    },
    [dragging, over, order, onMove, step, depthOf],
  )

  return { row, dragging }
}
