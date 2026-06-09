// End-to-end view-update round trip: POST /update edits a query-result cell,
// the markdown plugin rewrites the file on disk, and the change flows back
// through setFile/advance so the live query reflects it immediately.

import { markdownPlugin } from '@flow-md/plugin-markdown'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpServer } from '../src/server.js'
import { Vault } from '../src/vault.js'
import { type WatchHandle, watchVault } from '../src/watcher.js'

const md = (...lines: string[]) => lines.join('\n')

const TODO = md(
  '# Todo', //             line 1
  '',
  '- [ ] buy milk', //     line 3
  '- [x] ship release', // line 4
  '',
  '```datalog-query',
  'Task(path, status, text, line)',
  '```',
)

interface QueryJson {
  id: string
  source: string
  columns: string[]
  writable: string[]
  rows: Array<Array<string | number>>
}

describe('POST /update integration', () => {
  let dir: string
  let vault: Vault
  let watcher: WatchHandle
  let server: Server
  let base: string

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'flow-md-update-'))
    await writeFile(path.join(dir, 'todo.md'), TODO, 'utf8')
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

  async function getQuery(): Promise<QueryJson> {
    const body = (await (await fetch(`${base}/queries?file=todo.md`)).json()) as {
      queries: QueryJson[]
    }
    expect(body.queries).toHaveLength(1)
    return body.queries[0]!
  }

  async function post(
    endpoint: string,
    payload: unknown,
  ): Promise<{ status: number; body: { error: string | null } }> {
    const res = await fetch(`${base}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: res.status, body: (await res.json()) as { error: string | null } }
  }
  const postUpdate = (payload: unknown) => post('update', payload)

  it('serves writable metadata with query results', async () => {
    const q = await getQuery()
    expect(q.columns).toEqual(['path', 'status', 'text', 'line'])
    expect(q.writable).toEqual(['status', 'text'])
    expect(q.rows).toContainEqual(['todo.md', 'open', 'buy milk', 3])
  })

  it('toggles a task by query id: file on disk and live rows both update', async () => {
    const q = await getQuery()
    const { status, body } = await postUpdate({
      id: q.id,
      row: ['todo.md', 'open', 'buy milk', 3],
      column: 'status',
      value: 'closed',
    })
    expect(status).toBe(200)
    expect(body.error).toBeNull()

    const onDisk = await readFile(path.join(dir, 'todo.md'), 'utf8')
    expect(onDisk.split('\n')[2]).toBe('- [x] buy milk')

    const after = await getQuery()
    expect(after.rows).toContainEqual(['todo.md', 'closed', 'buy milk', 3])
    expect(after.rows).not.toContainEqual(['todo.md', 'open', 'buy milk', 3])
  })

  it('rejects a stale row with 409 after the file moved on', async () => {
    // The previous test closed "buy milk": its old row is now stale.
    const q = await getQuery()
    const { status, body } = await postUpdate({
      id: q.id,
      row: ['todo.md', 'open', 'buy milk', 3],
      column: 'status',
      value: 'closed',
    })
    expect(status).toBe(409)
    expect(body.error).toMatch(/no longer in the vault/)
  })

  it('updates through an ad-hoc query body', async () => {
    const { status } = await postUpdate({
      q: 'Task(path, "closed", text, _)',
      row: ['todo.md', 'ship release'],
      column: 'text',
      value: 'ship the release',
    })
    expect(status).toBe(200)
    const onDisk = await readFile(path.join(dir, 'todo.md'), 'utf8')
    expect(onDisk.split('\n')[3]).toBe('- [x] ship the release')
  })

  it('inserts a task via POST /insert and the live query picks it up', async () => {
    const { status, body } = await post('insert', {
      rel: 'Task',
      row: ['todo.md', 'open', 'water plants', 0],
    })
    expect(status).toBe(200)
    expect(body.error).toBeNull()

    const onDisk = await readFile(path.join(dir, 'todo.md'), 'utf8')
    expect(onDisk.split('\n').at(-1)).toBe('- [ ] water plants')
    const q = await getQuery()
    expect(q.rows.map((r) => r[2])).toContain('water plants')
  })

  it('deletes a task via POST /delete from a query row', async () => {
    const q = await getQuery()
    const row = q.rows.find((r) => r[2] === 'water plants')!
    const { status } = await post('delete', { id: q.id, row })
    expect(status).toBe(200)

    const onDisk = await readFile(path.join(dir, 'todo.md'), 'utf8')
    expect(onDisk).not.toContain('water plants')
    const after = await getQuery()
    expect(after.rows.map((r) => r[2])).not.toContain('water plants')
  })

  it('deletes by complete fact and 409s when it is already gone', async () => {
    await post('insert', { rel: 'Task', row: ['todo.md', 'open', 'temp', 0] })
    const q = await getQuery()
    const row = q.rows.find((r) => r[2] === 'temp')!
    const first = await post('delete', { rel: 'Task', row })
    expect(first.status).toBe(200)
    const second = await post('delete', { rel: 'Task', row })
    expect(second.status).toBe(409)
    expect(second.body.error).toMatch(/no longer in the vault/)
  })

  it('rejects malformed requests with 400 and unknown ids with 404', async () => {
    expect((await postUpdate({ row: 'nope' })).status).toBe(400)
    expect(
      (await postUpdate({ row: [], column: 'c', value: 'v' })).status,
    ).toBe(400)
    expect(
      (await postUpdate({ id: 'Qdeadbeef0000', row: [], column: 'c', value: 'v' }))
        .status,
    ).toBe(404)
    expect((await post('insert', { row: ['todo.md'] })).status).toBe(400)
    expect(
      (await post('delete', { row: ['todo.md', 'open', 'x', 1] })).status,
    ).toBe(409)
  })
})
