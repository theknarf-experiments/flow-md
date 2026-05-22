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
    vault = new Vault()
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
})
