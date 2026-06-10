import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SqliteTaskStore } from './store.js'
import { createUiServer } from './ui-server.js'

describe('POST /api/tasks', () => {
  let dir: string
  let store: SqliteTaskStore
  let server: ReturnType<typeof createUiServer>

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ui-test-'))
    store = new SqliteTaskStore(dir)
    server = createUiServer(store, { me: 'lead', html: '<!doctype html>' })
  })

  afterEach(() => {
    server.stop(true)
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const post = (body: unknown) =>
    fetch(`http://localhost:${server.port}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('creates a task and persists it', async () => {
    const res = await post({
      title: 'Wire up export',
      description: 'CSV path',
      project: 'relay',
      assignee: 'bob',
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as {
      id: string
      title: string
      project: string
      assignee?: string
      state: string
      createdBy?: string
    }
    expect(created.title).toBe('Wire up export')
    expect(created.project).toBe('relay')
    expect(created.assignee).toBe('bob')
    expect(created.state).toBe('todo')
    expect(created.createdBy).toBe('lead')

    const stored = await store.get(created.id)
    expect(stored?.title).toBe('Wire up export')
    expect(stored?.createdBy).toBe('lead')
  })

  it('rejects a missing title', async () => {
    const res = await post({ project: 'relay' })
    expect(res.status).toBe(400)
    expect(await store.list()).toHaveLength(0)
  })

  it('rejects a missing project', async () => {
    const res = await post({ title: 'No repo' })
    expect(res.status).toBe(400)
    expect(await store.list()).toHaveLength(0)
  })
})
