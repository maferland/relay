import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildTask, SqliteTaskStore } from './store.js'
import type { State } from './types.js'
import { createUiServer } from './ui-server.js'

describe('ui-server', () => {
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

  const postTo = (path: string, body: unknown) =>
    fetch(`http://localhost:${server.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  describe('POST /api/tasks', () => {
    const post = (body: unknown) => postTo('/api/tasks', body)

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

  describe('POST /api/tasks/:id/checkpoint', () => {
    const seed = async (state: State = 'todo') => {
      const task = buildTask({
        title: 'x',
        project: 'relay',
        state,
        actor: 'a',
      })
      await store.add(task)
      return task.id
    }
    const checkpoint = (id: string, body: unknown) =>
      postTo(`/api/tasks/${id}/checkpoint`, body)

    it('sets and clears the human checkpoints', async () => {
      const id = await seed()
      const set = (await (await checkpoint(id, { reviewed: true })).json()) as {
        humanReviewed?: boolean
        reviewedAt?: number
      }
      expect(set.humanReviewed).toBe(true)
      expect(typeof set.reviewedAt).toBe('number')

      const cleared = (await (
        await checkpoint(id, { reviewed: false })
      ).json()) as { humanReviewed?: boolean }
      expect(cleared.humanReviewed).toBeFalsy()
    })

    it('gates merge on a reviewed task until it is tested', async () => {
      const id = await seed('review')
      const blocked = await postTo(`/api/tasks/${id}/transition`, {
        to: 'merged',
      })
      expect(blocked.status).toBe(400)

      await checkpoint(id, { tested: true })
      const ok = await postTo(`/api/tasks/${id}/transition`, { to: 'merged' })
      expect(ok.status).toBe(200)
      expect(((await ok.json()) as { state: string }).state).toBe('merged')
    })

    it('rejects a checkpoint with no flag', async () => {
      const id = await seed()
      expect((await checkpoint(id, {})).status).toBe(400)
    })
  })
})
