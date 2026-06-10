// Compiled MDX passes no `node` prop to component overrides (unlike
// react-markdown), so source positions vanish — and with them block editing.
// This remark plugin stamps every top-level block's 1-based line range into
// attributes that survive MDX compilation:
//
//   • markdown nodes get hProperties data-block-start/end (→ DOM data-attrs)
//   • mdxJsxFlowElements get real JSX attributes, so <Kanban/> components
//     receive their own source range as props
//
// The markdown pipeline doesn't need it (node.position is native there);
// only MdxView adds this plugin.

import type { Root } from 'mdast'

interface MdxJsxAttribute {
  type: 'mdxJsxAttribute'
  name: string
  value: string
}

export function remarkBlockPositions() {
  return (tree: Root) => {
    for (const node of tree.children) {
      const pos = node.position
      if (!pos || node.type === 'yaml') continue
      if (node.type === 'mdxJsxFlowElement') {
        const el = node as unknown as { attributes: MdxJsxAttribute[] }
        el.attributes ??= []
        if (!el.attributes.some((a) => a.name === 'data-block-start')) {
          el.attributes.push(
            attr('data-block-start', pos.start.line),
            attr('data-block-end', pos.end.line),
          )
        }
      } else {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            'data-block-start': pos.start.line,
            'data-block-end': pos.end.line,
          },
        }
      }
    }
  }
}

function attr(name: string, line: number): MdxJsxAttribute {
  return { type: 'mdxJsxAttribute', name, value: String(line) }
}
