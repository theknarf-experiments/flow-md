import { type DragEvent, useCallback, useState } from 'react'

export interface ReorderHandlers<T extends string | number> {
  /** Props for a row: makes it draggable and a drop target. */
  row: (id: T) => {
    draggable: true
    onDragStart: (e: DragEvent) => void
    onDragOver: (e: DragEvent) => void
    onDragLeave: () => void
    onDrop: (e: DragEvent) => void
    onDragEnd: () => void
    'data-dragging'?: boolean
    'data-drop'?: 'before' | 'after'
  }
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
  onMove: (id: T, before: T | null) => void,
  order: readonly T[],
): ReorderHandlers<T> {
  const [dragging, setDragging] = useState<T | null>(null)
  const [over, setOver] = useState<{ id: T; after: boolean } | null>(null)

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
          setOver({ id, after: e.clientY > box.top + box.height / 2 })
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
          onMove(moved, before)
        },
        onDragEnd: () => {
          setDragging(null)
          setOver(null)
        },
        ...(dragging === id ? { 'data-dragging': true } : {}),
        ...(isOver ? { 'data-drop': over.after ? ('after' as const) : ('before' as const) } : {}),
      }
    },
    [dragging, over, order, onMove],
  )

  return { row, dragging }
}
