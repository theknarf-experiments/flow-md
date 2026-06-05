// The markdown plugin: claims `.md` files, contributes the markdown EDB
// schema, and parses each file into facts plus `datalog`/`datalog-query`
// code blocks.

import type { Plugin } from '@flow-md/plugin-api'
import { QUERY_LANG, RULE_LANG, parseMarkdown } from './parse.js'
import { MARKDOWN_SCHEMA } from './schema.js'

export const markdownPlugin: Plugin = {
  name: 'markdown',
  extensions: ['.md'],
  schema: MARKDOWN_SCHEMA,
  codeBlockLangs: { rule: RULE_LANG, query: QUERY_LANG },
  parse: parseMarkdown,
}

export { parseMarkdown, MARKDOWN_SCHEMA }
export default markdownPlugin
