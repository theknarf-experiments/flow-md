// The registered view plugins. Each contributes MDX components (keyed by
// their JSX tag); their union is the registry passed to every MDX block.
//
// Adding a view type is now a one-line change here (plus the dependency) —
// the components themselves live in standalone @flow-md/view-* packages and
// depend only on @flow-md/view-api, so third parties can ship their own.

import type {
  FileHandler,
  FlowMdViewPlugin,
  ViewComponent,
} from '@flow-md/view-api'
import { diagramPlugin } from '@flow-md/view-diagram'
import { fileTreePlugin } from '@flow-md/view-filetree'
import { graphPlugin } from '@flow-md/view-graph'
import { icsViewPlugin } from '@flow-md/view-ics'
import { kanbanPlugin } from '@flow-md/view-kanban'

export const viewPlugins: FlowMdViewPlugin[] = [
  kanbanPlugin,
  graphPlugin,
  fileTreePlugin,
  icsViewPlugin,
  diagramPlugin,
]

/** Flattened JSX-tag → component map for the MDX component registry. */
export const viewComponents: Record<string, ViewComponent> = Object.fromEntries(
  viewPlugins.flatMap((p) => Object.entries(p.components ?? {})),
)

/** File extension → default viewer, from plugins that register one. */
export const fileHandlers: Record<string, FileHandler> = Object.fromEntries(
  viewPlugins.flatMap((p) => Object.entries(p.fileHandlers ?? {})),
)
