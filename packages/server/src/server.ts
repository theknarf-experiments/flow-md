// Minimal JSON HTTP API over a Vault. No framework — node:http is plenty for
// a handful of endpoints.
//
//   GET  /health                → { ok, error }
//   GET  /queries?file=<rel>    → { error, queries: QueryResult[] }
//   GET  /queries?abspath=<abs> → same, but resolved against the vault root
//   GET  /query/<id>            → QueryResult | 404
//   GET  /run?q=<datalog>       → { error, columns, writable, rows }
//   GET  /files                 → { error, files: string[] }
//   GET  /contents              → { error, files: [{ path, content, mtime }] }
//   GET  /file?path=<rel>       → { path, content } (raw source text)
//   PUT  /file                  → save { path, content }; new files allowed
//   POST /update                → write a query-result edit back to source
//   POST /delete                → remove the source text behind a fact
//   POST /insert                → add source text deriving a new fact
//
// Every response carries permissive CORS headers (and OPTIONS preflights are
// answered) so browser apps — e.g. the flow-md web app on a Vite dev port —
// can talk to the server directly.
//
// `file` is a vault-relative path (forward slashes), matching how the watcher
// keys files. `abspath` lets a client (e.g. the editor) pass the buffer's
// absolute path and have the server compute the relative key — so the editor
// needs no knowledge of the vault root or its own working directory.
//
// /update takes { id | q, row, column, value }: the query (a registered
// block's id, or an ad-hoc body), the result row as served, the column being
// edited, and its new value. The vault traces the edit to a source fact
// (lineage.ts), re-verifies the fact against the file's current content (the
// concurrency check — a changed file means 409), the owning plugin rewrites
// the text, and the file is replaced atomically (temp + rename). The new
// content is then fed straight back through setFile/advance — the same path
// the watcher uses — so every dependent query updates incrementally; the
// watcher's own event for our write becomes a no-op delta.
//
// /delete takes either a complete fact { rel, row } or a query row
// { id | q, row [, rel] } resolved through the same lineage. /insert takes a
// complete fact { rel, row }; the target file comes from the relation's
// declared path attribute (WritableRel.pathAttr, validated at startup), and
// locator columns the client can't know yet (line numbers) are passed as 0.

import type { Cell } from '@flow-md/plugin-api'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http'
import path from 'node:path'
import type { Vault } from './vault.js'

export function createHttpServer(vault: Vault, root: string): Server {
  const absRoot = path.resolve(root)
  const toRel = (abspath: string): string =>
    path.relative(absRoot, path.resolve(abspath)).split(path.sep).join('/')

  return createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('access-control-allow-origin', '*')

    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS')
      res.setHeader('access-control-allow-headers', 'content-type')
      res.writeHead(204)
      return res.end()
    }

    const pathname = req.url?.split('?')[0]
    if (
      req.method === 'POST' &&
      (pathname === '/update' || pathname === '/delete' || pathname === '/insert')
    ) {
      handleMutation(pathname.slice(1), req, res, vault, absRoot).catch((err) =>
        json(res, 500, { error: err instanceof Error ? err.message : String(err) }),
      )
      return
    }
    if (req.method === 'PUT' && pathname === '/file') {
      handleSave(req, res, vault, absRoot).catch((err) =>
        json(res, 500, { error: err instanceof Error ? err.message : String(err) }),
      )
      return
    }
    if (req.method !== 'GET') {
      return json(res, 405, { error: 'method not allowed' })
    }

    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/health') {
      return json(res, 200, { ok: vault.error() === null, error: vault.error() })
    }

    if (url.pathname === '/files') {
      return json(res, 200, { error: vault.error(), files: vault.paths() })
    }

    if (url.pathname === '/contents') {
      return json(res, 200, { error: vault.error(), files: vault.contents() })
    }

    if (url.pathname === '/file') {
      const rel = url.searchParams.get('path') ?? ''
      const target = resolveInRoot(absRoot, rel)
      if (!target || !vault.accepts(rel)) {
        return json(res, 400, { error: 'invalid path' })
      }
      readFile(target, 'utf8').then(
        (content) => json(res, 200, { path: rel, content }),
        () => json(res, 404, { error: `no file "${rel}"` }),
      )
      return
    }

    if (url.pathname === '/queries') {
      const abspath = url.searchParams.get('abspath')
      const file = abspath
        ? toRel(abspath)
        : (url.searchParams.get('file') ?? undefined)
      return json(res, 200, { error: vault.error(), queries: vault.queries(file) })
    }

    if (url.pathname === '/run') {
      const q = url.searchParams.get('q') ?? ''
      if (!q.trim()) return json(res, 400, { error: 'missing query (?q=)' })
      return json(res, 200, vault.runQuery(q))
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

interface MutationBody {
  id?: string
  q?: string
  rel?: string
  row: Cell[]
  column?: string
  value?: Cell
}

const isCell = (v: unknown): v is Cell =>
  typeof v === 'string' || typeof v === 'number'

async function handleMutation(
  kind: string,
  req: IncomingMessage,
  res: ServerResponse,
  vault: Vault,
  absRoot: string,
): Promise<void> {
  let body: MutationBody
  try {
    body = JSON.parse(await readBody(req)) as MutationBody
  } catch {
    return json(res, 400, { error: 'invalid JSON body' })
  }
  if (!Array.isArray(body.row) || !body.row.every(isCell)) {
    return json(res, 400, { error: 'missing or malformed row' })
  }

  // /update and the query form of /delete name their view by id or body.
  let source: string | undefined
  if (typeof body.q === 'string' && body.q.trim()) {
    source = body.q
  } else if (typeof body.id === 'string') {
    const entry = vault.query(body.id)
    if (!entry) return json(res, 404, { error: 'unknown query id' })
    source = entry.source
  }

  try {
    if (kind === 'update') {
      if (typeof body.column !== 'string' || !isCell(body.value)) {
        return json(res, 400, { error: 'expected { id | q, row, column, value }' })
      }
      if (!source) return json(res, 400, { error: 'missing query (id or q)' })
      const { path: relPath, oldFact, newFact } = vault.resolveUpdate(
        source,
        body.row,
        body.column,
        body.value,
      )
      await applyWrite(vault, absRoot, relPath, res, (content) =>
        vault.applyFactUpdate(relPath, content, oldFact, newFact),
      )
      return json(res, 200, { error: null, path: relPath, oldFact, newFact })
    }

    if (kind === 'delete') {
      const { path: relPath, fact } = vault.resolveDelete({
        ...(body.rel !== undefined ? { rel: body.rel } : {}),
        ...(source !== undefined ? { source } : {}),
        row: body.row,
      })
      await applyWrite(vault, absRoot, relPath, res, (content) =>
        vault.applyFactDelete(relPath, content, fact),
      )
      return json(res, 200, { error: null, path: relPath, fact })
    }

    // insert
    if (typeof body.rel !== 'string') {
      return json(res, 400, { error: 'expected { rel, row }' })
    }
    const { path: relPath, fact } = vault.resolveInsert(body.rel, body.row)
    await applyWrite(vault, absRoot, relPath, res, (content) =>
      vault.applyFactInsert(relPath, content, fact),
    )
    return json(res, 200, { error: null, path: relPath, fact })
  } catch (err) {
    if (res.writableEnded) return
    // Resolution and apply failures are conflicts between the client's view
    // of the data and the vault/file state, not malformed requests.
    json(res, 409, { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Save a file's full content (the web app's editor). New files are allowed
 *  as long as a plugin claims the extension; the write is atomic and feeds
 *  back through setFile/advance like every other mutation. */
async function handleSave(
  req: IncomingMessage,
  res: ServerResponse,
  vault: Vault,
  absRoot: string,
): Promise<void> {
  let body: { path?: string; content?: string }
  try {
    body = JSON.parse(await readBody(req)) as { path?: string; content?: string }
  } catch {
    return json(res, 400, { error: 'invalid JSON body' })
  }
  const rel = body.path ?? ''
  if (typeof rel !== 'string' || typeof body.content !== 'string') {
    return json(res, 400, { error: 'expected { path, content }' })
  }
  const target = resolveInRoot(absRoot, rel)
  if (!target || !vault.accepts(rel)) {
    return json(res, 400, { error: 'invalid path' })
  }
  await mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.flow-md-tmp`
  await writeFile(tmp, body.content, 'utf8')
  await rename(tmp, target)
  const st = await stat(target)
  vault.setFile(rel, body.content, st.mtimeMs)
  vault.advance()
  json(res, 200, { error: vault.error(), path: rel })
}

/** Absolute path of `rel` inside the vault root, or null if it escapes. */
function resolveInRoot(absRoot: string, rel: string): string | null {
  if (!rel) return null
  const target = path.join(absRoot, rel)
  const back = path.relative(absRoot, target)
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null
  return target
}

/** Shared read-modify-write: mutate the file's current content, replace it
 *  atomically, and feed the result back through the vault's normal read path
 *  so dependent queries update incrementally without waiting on the
 *  watcher's debounce. */
async function applyWrite(
  vault: Vault,
  absRoot: string,
  relPath: string,
  res: ServerResponse,
  mutate: (content: string) => string,
): Promise<void> {
  const target = path.join(absRoot, relPath)
  if (path.relative(absRoot, target).startsWith('..')) {
    json(res, 400, { error: 'path escapes the vault root' })
    throw new Error('path escapes the vault root')
  }
  const content = await readFile(target, 'utf8')
  const updated = mutate(content)
  const tmp = `${target}.flow-md-tmp`
  await writeFile(tmp, updated, 'utf8')
  await rename(tmp, target)
  const st = await stat(target)
  vault.setFile(relPath, updated, st.mtimeMs)
  vault.advance()
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status)
  res.end(JSON.stringify(body))
}
