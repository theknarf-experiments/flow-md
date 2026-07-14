// React elements → modular-svg JSON scene, by static traversal.
//
// modular-svg ships a React binding built on react-reconciler, but custom
// reconcilers are pinned to specific React internals (its 0.33 needs React
// 19; this app runs 18). Scene JSX never needs a reconciler though: the
// primitives are plain string-typed elements, so a pure walk over the
// element tree produces the same JSON the reconciler would (mirroring its
// instanceToJson: capitalized types, Ref flattened, text children joined
// into props.text, multiple roots wrapped in a Group) — and unlike the
// reconciler we read `element.key` directly, so `key`-targeted arrows are
// reliable. Function components inside scenes aren't supported (that's the
// one thing a reconciler would add); primitives, arrays, fragments and
// expressions are.

import { Fragment, type ReactNode, isValidElement } from 'react'

export type SceneJson = Record<string, unknown>

/** Flatten a ReactNode tree into scene JSON roots. */
function walk(node: ReactNode, out: SceneJson[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return
  }
  if (!isValidElement(node)) return // stray strings/numbers outside <text>
  if (node.type === Fragment) {
    walk((node.props as { children?: ReactNode }).children, out)
    return
  }
  if (typeof node.type !== 'string') {
    throw new Error(
      `diagram scenes are built from primitive tags (stackH, rect, …); ` +
        `found a component (${componentName(node.type)})`,
    )
  }
  out.push(elementToJson(node.type, node.key, node.props as Record<string, unknown>))
}

function componentName(type: unknown): string {
  if (typeof type === 'function') return type.name || 'anonymous'
  return String(type)
}

function elementToJson(
  type: string,
  key: string | null,
  props: Record<string, unknown>,
): SceneJson {
  const capitalized = type.charAt(0).toUpperCase() + type.slice(1)

  // Refs are flat: { type: 'Ref', target }.
  if (type === 'ref') return { type: capitalized, target: props.target }

  const { children, ...rest } = props
  const childJson: SceneJson[] = []
  walk(children as ReactNode, childJson)

  const finalProps: Record<string, unknown> = { ...rest }
  if (type === 'text' && finalProps.text === undefined) {
    const text = textContent(children as ReactNode)
    if (text) finalProps.text = text
  }

  return {
    type: capitalized,
    ...(key !== null ? { key } : {}),
    props: finalProps,
    children: childJson,
  }
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  return ''
}

/** The scene JSON for a Graphic's children: single root as-is, several
 *  wrapped in a Group (mirroring the reconciler), none → null. */
export function childrenToScene(children: ReactNode): SceneJson | null {
  const roots: SceneJson[] = []
  walk(children, roots)
  if (roots.length === 0) return null
  if (roots.length === 1) return roots[0]!
  return { type: 'Group', props: {}, children: roots }
}
