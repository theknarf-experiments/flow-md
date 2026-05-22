// Minimal JSON HTTP API over a Vault. No framework — node:http is plenty for
// three read-only endpoints.
//
//   GET /health                → { ok, error }
//   GET /queries?file=<rel>     → { error, queries: QueryResult[] }
//   GET /queries?abspath=<abs>  → same, but resolved against the vault root
//   GET /query/<id>             → QueryResult | 404
//
// `file` is a vault-relative path (forward slashes), matching how the watcher
// keys files. `abspath` lets a client (e.g. the editor) pass the buffer's
// absolute path and have the server compute the relative key — so the editor
// needs no knowledge of the vault root or its own working directory.

import { type Server, type ServerResponse, createServer } from 'node:http'
import path from 'node:path'
import type { Vault } from './vault.js'

export function createHttpServer(vault: Vault, root: string): Server {
  const absRoot = path.resolve(root)
  const toRel = (abspath: string): string =>
    path.relative(absRoot, path.resolve(abspath)).split(path.sep).join('/')

  return createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method !== 'GET') {
      return json(res, 405, { error: 'method not allowed' })
    }

    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/health') {
      return json(res, 200, { ok: vault.error() === null, error: vault.error() })
    }

    if (url.pathname === '/queries') {
      const abspath = url.searchParams.get('abspath')
      const file = abspath
        ? toRel(abspath)
        : (url.searchParams.get('file') ?? undefined)
      return json(res, 200, { error: vault.error(), queries: vault.queries(file) })
    }

    const match = url.pathname.match(/^\/query\/([A-Za-z0-9]+)$/)
    if (match) {
      const result = vault.query(match[1]!)
      return result
        ? json(res, 200, result)
        : json(res, 404, { error: 'unknown query id' })
    }

    json(res, 404, { error: 'not found' })
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status)
  res.end(JSON.stringify(body))
}
