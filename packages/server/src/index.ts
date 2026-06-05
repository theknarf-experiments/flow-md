// Public API of @flow-md/server.

export { Vault, type QueryResult, type VaultOptions } from './vault.js'
export { buildSchema, edbSectionText, type SchemaView } from './schema.js'
export { PluginRegistry } from './registry.js'
export { watchVault, type WatchHandle } from './watcher.js'
export { createHttpServer } from './server.js'
export type {
  Cell,
  CodeBlockLangs,
  DataType,
  EdbDef,
  Fact,
  ParseResult,
  Plugin,
  QueryBlock,
} from '@flow-md/plugin-api'
