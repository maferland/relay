import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildTask, SqliteTaskStore } from './store.js'
import type { Task } from './types.js'

function makeTask(id: string, over: Partial<Task> = {}): Task {
  const now = new Date().toISOString()
  return {
    id,
    title: 'do the thing',
    state: 'todo',
    project: 'demo',
    createdBy: 'lead',
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, actor: 'lead', to: 'todo', note: 'created' }],
    ...over,
  }
}

describe('SqliteTaskStore', () => {
  let dir: string
  let store: SqliteTaskStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'))
    store = new SqliteTaskStore(dir)
  })

  afterEach(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a task', async () => {
    const task = makeTask('task-abc123')
    await store.add(task)
    expect(await store.get('task-abc123')).toEqual(task)
  })

  it('returns null for a missing task', async () => {
    expect(await store.get('task-nope')).toBeNull()
  })

  it('records a state transition with from/to in history', async () => {
    await store.add(makeTask('task-1'))
    const updated = await store.update(
      'task-1',
      { state: 'review' },
      { actor: 'worker', note: 'ready' }
    )
    expect(updated.state).toBe('review')
    expect(updated.history.at(-1)).toMatchObject({
      from: 'todo',
      to: 'review',
      actor: 'worker',
      note: 'ready',
    })
  })

  it('bumps updatedAt and records a note-only event when state is unchanged', async () => {
    await store.add(
      makeTask('task-1', { updatedAt: '2020-01-01T00:00:00.000Z' })
    )
    const updated = await store.update(
      'task-1',
      { assignee: 'worker-2' },
      { actor: 'lead', note: 'reassigned' }
    )
    expect(updated.assignee).toBe('worker-2')
    expect(updated.history.at(-1)!.from).toBeUndefined()
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date('2020-01-01').getTime()
    )
  })

  it('requires a note to send a task back from review', async () => {
    await store.add(makeTask('task-1', { state: 'review' }))
    await expect(
      store.update('task-1', { state: 'todo' }, { actor: 'qa' })
    ).rejects.toThrow(/note is required/)
    const withNote = await store.update(
      'task-1',
      { state: 'todo' },
      { actor: 'qa', note: 'missing tests' }
    )
    expect(withNote.history.at(-1)).toMatchObject({
      from: 'review',
      to: 'todo',
      note: 'missing tests',
    })
  })

  it('requires a note to block a task but not to move forward', async () => {
    await store.add(makeTask('task-1'))
    await expect(
      store.update('task-1', { state: 'blocked' }, { actor: 'w' })
    ).rejects.toThrow(/note is required/)
    expect(
      (await store.update('task-1', { state: 'doing' }, { actor: 'w' })).state
    ).toBe('doing')
  })

  it('throws updating a missing task', async () => {
    await expect(store.update('task-x', { state: 'done' }, {})).rejects.toThrow(
      /not found/
    )
  })

  it('refuses to add a task whose id already exists (never clobbers history)', async () => {
    await store.add(makeTask('task-1'))
    await store.update('task-1', { state: 'doing' }, { actor: 'w' })
    await expect(
      store.add(makeTask('task-1', { title: 'other' }))
    ).rejects.toThrow(/already exists/)
    const task = await store.get('task-1')
    expect(task!.title).toBe('do the thing') // original preserved
    expect(task!.history.length).toBe(2)
  })

  it('rejects an invalid since timestamp', async () => {
    await expect(store.list({ since: 'not-a-date' })).rejects.toThrow(
      /Invalid since/
    )
  })

  it('rejects path-escaping ids', async () => {
    await expect(store.get('../escape')).rejects.toThrow(/Invalid task id/)
  })

  it('clears assignee/description when given an empty string', async () => {
    await store.add(makeTask('task-1', { assignee: 'bob', description: 'old' }))
    const cleared = await store.update(
      'task-1',
      { assignee: '', description: '' },
      { actor: 'lead' }
    )
    expect(cleared.assignee).toBeUndefined()
    expect(cleared.description).toBeUndefined()
  })

  describe('claim', () => {
    it('assigns and moves an open task to doing', async () => {
      await store.add(makeTask('task-1'))
      const claimed = await store.claim('task-1', {
        assignee: 'w1',
        actor: 'w1',
      })
      expect(claimed.state).toBe('doing')
      expect(claimed.assignee).toBe('w1')
    })

    it('refuses to claim a task in review or done', async () => {
      await store.add(makeTask('task-r', { state: 'review' }))
      await store.add(makeTask('task-d', { state: 'done' }))
      await expect(store.claim('task-r', { assignee: 'w1' })).rejects.toThrow(
        /reopen/
      )
      await expect(store.claim('task-d', { assignee: 'w1' })).rejects.toThrow(
        /reopen/
      )
    })
  })

  describe('escalate / resolve (needs-human)', () => {
    it('flags a task for a human and surfaces it via the needsHuman filter', async () => {
      await store.add(makeTask('task-1', { state: 'doing' }))
      const escalated = await store.escalate('task-1', {
        actor: 'worker',
        note: 'need staging creds',
      })
      expect(escalated.needsHuman).toBe(true)
      expect(escalated.state).toBe('doing') // orthogonal to state
      expect(escalated.history.at(-1)).toMatchObject({
        actor: 'worker',
        note: 'need staging creds',
      })
      expect((await store.list({ needsHuman: true })).map((t) => t.id)).toEqual(
        ['task-1']
      )
    })

    it('requires a note to escalate', async () => {
      await store.add(makeTask('task-1'))
      await expect(store.escalate('task-1', { actor: 'w' })).rejects.toThrow(
        /note is required/
      )
    })

    it('resolve clears the flag and drops it from the human inbox', async () => {
      await store.add(makeTask('task-1'))
      await store.escalate('task-1', { actor: 'w', note: 'help' })
      const resolved = await store.resolve('task-1', {
        actor: 'lead',
        note: 'creds granted',
      })
      expect(resolved.needsHuman).toBeUndefined()
      expect(await store.list({ needsHuman: true })).toEqual([])
    })
  })

  describe('buildTask', () => {
    it('requires a note to create a task already blocked', () => {
      expect(() =>
        buildTask({ title: 'x', project: 'p', state: 'blocked' })
      ).toThrow(/note is required/)
      expect(
        buildTask({
          title: 'x',
          project: 'p',
          state: 'blocked',
          note: 'waiting on API',
        }).state
      ).toBe('blocked')
    })

    it('rejects an empty title and normalizes empty optionals to undefined', () => {
      expect(() => buildTask({ title: '  ', project: 'p' })).toThrow(
        /title is required/
      )
      const t = buildTask({
        title: 'x',
        project: 'p',
        assignee: '',
        description: '',
      })
      expect(t.assignee).toBeUndefined()
      expect(t.description).toBeUndefined()
    })
  })

  describe('list filtering', () => {
    const past = '2020-01-01T00:00:00.000Z'
    beforeEach(async () => {
      await store.add(
        makeTask('task-a', {
          state: 'todo',
          project: 'alpha',
          assignee: 'w1',
          updatedAt: past,
        })
      )
      await store.add(
        makeTask('task-b', {
          state: 'review',
          project: 'alpha',
          assignee: 'w2',
          updatedAt: past,
        })
      )
      await store.add(
        makeTask('task-c', {
          state: 'review',
          project: 'beta',
          assignee: 'w1',
          updatedAt: past,
        })
      )
    })

    it('filters by state', async () => {
      expect(
        (await store.list({ state: 'review' })).map((t) => t.id).sort()
      ).toEqual(['task-b', 'task-c'])
    })

    it('filters by project and assignee together', async () => {
      expect(
        (await store.list({ project: 'alpha', assignee: 'w2' })).map(
          (t) => t.id
        )
      ).toEqual(['task-b'])
    })

    it('filters by since (updatedAt >=)', async () => {
      await store.update('task-c', { state: 'done' }, { actor: 'w1' })
      const since = (await store.get('task-c'))!.updatedAt
      expect((await store.list({ since })).map((t) => t.id)).toEqual(['task-c'])
    })
  })

  describe('concurrency', () => {
    it('does not drop history under concurrent updates to the same task', async () => {
      await store.add(makeTask('task-hot'))
      await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          store.update('task-hot', {}, { actor: `w${i}`, note: `n${i}` })
        )
      )
      const task = await store.get('task-hot')
      expect(task!.history.length).toBe(31) // creation + 30, none dropped
      expect(new Set(task!.history.slice(1).map((e) => e.note)).size).toBe(30)
    })

    it('updates different tasks independently', async () => {
      await store.add(makeTask('task-a'))
      await store.add(makeTask('task-b'))
      const [a, b] = await Promise.all([
        store.update('task-a', { state: 'doing' }, { actor: 'w' }),
        store.update('task-b', { state: 'doing' }, { actor: 'w' }),
      ])
      expect([a.state, b.state]).toEqual(['doing', 'doing'])
    })
  })
})
