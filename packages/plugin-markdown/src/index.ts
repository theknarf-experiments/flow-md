// The markdown plugin: claims `.md` files, contributes the markdown EDB
// schema, parses each file into facts plus `datalog`/`datalog-query`
// code blocks, and can write a fact edit back into the source text.

import type { Plugin } from '@flow-md/plugin-api'
import { QUERY_LANG, RULE_LANG, parseMarkdown } from './parse.js'
import { MARKDOWN_SCHEMA } from './schema.js'
import {
  MARKDOWN_WRITABLE,
  deleteMarkdownFact,
  insertMarkdownFact,
  updateMarkdownFact,
} from './update.js'

export const markdownPlugin: Plugin = {
  name: 'markdown',
  extensions: ['.md'],
  schema: MARKDOWN_SCHEMA,
  codeBlockLangs: { rule: RULE_LANG, query: QUERY_LANG },
  parse: parseMarkdown,
  writable: MARKDOWN_WRITABLE,
  updateFact: updateMarkdownFact,
  deleteFact: deleteMarkdownFact,
  insertFact: insertMarkdownFact,
}

export {
  parseMarkdown,
  MARKDOWN_SCHEMA,
  MARKDOWN_WRITABLE,
  deleteMarkdownFact,
  insertMarkdownFact,
  updateMarkdownFact,
}
export default markdownPlugin
