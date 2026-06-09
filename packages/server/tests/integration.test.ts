import { markdownPlugin } from '@flow-md/plugin-markdown'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpServer } from '../src/server.js'
import { Vault } from '../src/vault.js'
import { type WatchHandle, watchVault } from '../src/watcher.js'

const md = (...lines: string[]) => lines.join('\n')

const NOTE = md(
  '---',
  'tags: [project]',
  '---',
  '# Note',
  '',
  '```datalog',
  'ProjectFile(p) :- Tag(p, "project").',
  '```',
  '',
  '```datalog-query',
  'ProjectFile(p)',
  '```',
)

async function waitFor(fn: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('watcher + http integration', () => {
  let dir: string
  let vault: Vault
  let watcher: WatchHandle
  let server: Server
  let base: string

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'flow-md-'))
    await writeFile(path.join(dir, 'a.md'), NOTE, 'utf8')
    vault = new Vault([markdownPlugin])
    watcher = watchVault(dir, vault)
    await watcher.ready
    server = createHttpServer(vault, dir)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr = server.address()
    if (addr === null || typeof addr === 'string') throw new Error('no port')
    base = `http://localhost:${addr.port}`
  })

  afterAll(async () => {
    await watcher.close()
    server.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('loads the initial vault and serves its query', async () => {
    const res = await fetch(`${base}/queries?file=a.md`)
    const body = (await res.json()) as {
      error: string | null
      queries: Array<{ columns: string[]; rows: unknown[][]; line: number }>
    }
    expect(body.error).toBeNull()
    expect(body.queries).toHaveLength(1)
    expect(body.queries[0]!.columns).toEqual(['p'])
    expect(body.queries[0]!.rows).toEqual([['a.md']])
    expect(body.queries[0]!.line).toBe(10)
  })

  it('resolves an absolute path against the vault root (cwd-independent)', async () => {
    const abs = path.join(dir, 'a.md')
    const res = await fetch(`${base}/queries?abspath=${encodeURIComponent(abs)}`)
    const body = (await res.json()) as {
      queries: Array<{ rows: unknown[][] }>
    }
    expect(body.queries).toHaveLength(1)
    expect(body.queries[0]!.rows).toEqual([['a.md']])
  })

  it('serves a single query by id and reports health', async () => {
    const list = (await (await fetch(`${base}/queries`)).json()) as {
      queries: Array<{ id: string }>
    }
    const id = list.queries[0]!.id
    const one = (await (await fetch(`${base}/query/${id}`)).json()) as {
      rows: unknown[][]
    }
    expect(one.rows).toEqual([['a.md']])

    const health = (await (await fetch(`${base}/health`)).json()) as {
      ok: boolean
    }
    expect(health.ok).toBe(true)

    expect((await fetch(`${base}/query/nope`)).status).toBe(404)
  })

  it('incrementally folds in a new file detected by the watcher', async () => {
    await writeFile(
      path.join(dir, 'b.md'),
      md('---', 'tags: [project]', '---', '# B'),
      'utf8',
    )
    await waitFor(() => {
      const q = vault.queries('a.md')[0]
      return (q?.rows.length ?? 0) === 2
    })
    const q = vault.queries('a.md')[0]!
    expect(q.rows.map((r) => r[0]).sort()).toEqual(['a.md', 'b.md'])
  })

  it('lists files, serves raw content and saves edits', async () => {
    const files = (await (await fetch(`${base}/files`)).json()) as {
      files: string[]
    }
    expect(files.files).toContain('a.md')

    const bulk = (await (await fetch(`${base}/contents`)).json()) as {
      files: Array<{ path: string; content: string; mtime: number }>
    }
    const entry = bulk.files.find((f) => f.path === 'a.md')
    expect(entry?.content).toBe(NOTE)
    expect(entry?.mtime).toBeGreaterThan(0)

    const got = (await (
      await fetch(`${base}/file?path=a.md`)
    ).json()) as { path: string; content: string }
    expect(got.content).toBe(NOTE)

    // Save a new file through PUT /file; the vault folds it in immediately.
    const res = await fetch(`${base}/file`, {
      method: 'PUT',
      body: JSON.stringify({
        path: 'sub/new.md',
        content: md('---', 'tags: [project]', '---', '# New'),
      }),
    })
    expect(res.status).toBe(200)
    const q = vault.queries('a.md')[0]!
    expect(q.rows.map((r) => r[0])).toContain('sub/new.md')

    // Path traversal and unclaimed extensions are rejected.
    expect((await fetch(`${base}/file?path=../secret.md`)).status).toBe(400)
    expect(
      (
        await fetch(`${base}/file`, {
          method: 'PUT',
          body: JSON.stringify({ path: 'x.exe', content: 'nope' }),
        })
      ).status,
    ).toBe(400)
  })

  it('creates folders, moves and deletes files and folders', async () => {
    // mkdir shows up in /dirs even while empty.
    expect(
      (
        await fetch(`${base}/mkdir`, {
          method: 'POST',
          body: JSON.stringify({ path: 'projects/alpha' }),
        })
      ).status,
    ).toBe(200)
    const dirs = (await (await fetch(`${base}/dirs`)).json()) as { dirs: string[] }
    expect(dirs.dirs).toContain('projects/alpha')

    // Move a file into it; the vault re-keys immediately.
    await fetch(`${base}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: 'moveme.md', content: '# Move me' }),
    })
    const mv = await fetch(`${base}/move`, {
      method: 'POST',
      body: JSON.stringify({ from: 'moveme.md', to: 'projects/alpha/moved.md' }),
    })
    expect(mv.status).toBe(200)
    expect(vault.paths()).toContain('projects/alpha/moved.md')
    expect(vault.paths()).not.toContain('moveme.md')

    // Rename the folder: every file under it re-keys.
    await fetch(`${base}/move`, {
      method: 'POST',
      body: JSON.stringify({ from: 'projects/alpha', to: 'projects/beta' }),
    })
    expect(vault.paths()).toContain('projects/beta/moved.md')

    // Delete the file, then the folder.
    await fetch(`${base}/file?path=${encodeURIComponent('projects/beta/moved.md')}`, {
      method: 'DELETE',
    })
    expect(vault.paths()).not.toContain('projects/beta/moved.md')
    await fetch(`${base}/folder?path=projects`, { method: 'DELETE' })
    const after = (await (await fetch(`${base}/dirs`)).json()) as { dirs: string[] }
    expect(after.dirs).not.toContain('projects')

    // Traversal is rejected on every fs endpoint.
    expect(
      (
        await fetch(`${base}/move`, {
          method: 'POST',
          body: JSON.stringify({ from: 'a.md', to: '../escape.md' }),
        })
      ).status,
    ).toBe(400)
    expect((await fetch(`${base}/folder?path=..`, { method: 'DELETE' })).status).toBe(400)
  })

  it('answers CORS preflights and marks responses cross-origin-safe', async () => {
    const pre = await fetch(`${base}/queries`, { method: 'OPTIONS' })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-methods')).toContain('PUT')
    const got = await fetch(`${base}/health`)
    expect(got.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('answers a one-off query via GET /run', async () => {
    const res = await fetch(`${base}/run?q=${encodeURIComponent('ProjectFile(p)')}`)
    const body = (await res.json()) as {
      error: string | null
      columns: string[]
      rows: unknown[][]
    }
    expect(body.error).toBeNull()
    expect(body.columns).toEqual(['p'])
    // a.md (and b.md from the previous test) are project-tagged.
    expect(body.rows.map((r) => r[0])).toContain('a.md')

    // Missing query string → 400.
    expect((await fetch(`${base}/run`)).status).toBe(400)
  })
})
