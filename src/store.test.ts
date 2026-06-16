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
    await expect(
      store.update('task-x', { state: 'merged' }, {})
    ).rejects.toThrow(/not found/)
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

  it('sets and clears watcher via update', async () => {
    await store.add(makeTask('task-w'))
    const withWatcher = await store.update(
      'task-w',
      { watcher: 'orchestrator' },
      { actor: 'lead' }
    )
    expect(withWatcher.watcher).toBe('orchestrator')
    const cleared = await store.update(
      'task-w',
      { watcher: null },
      { actor: 'lead' }
    )
    expect(cleared.watcher).toBeUndefined()
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

    it('refuses to claim a task already claimed by another agent', async () => {
      await store.add(
        makeTask('task-taken', { state: 'doing', assignee: 'w1' })
      )
      await expect(
        store.claim('task-taken', { assignee: 'w2' })
      ).rejects.toThrow(/already claimed/)
    })

    it('allows stealing a claim with --force', async () => {
      await store.add(
        makeTask('task-taken2', { state: 'doing', assignee: 'w1' })
      )
      const stolen = await store.claim('task-taken2', {
        assignee: 'w2',
        force: true,
      })
      expect(stolen.assignee).toBe('w2')
    })

    it('allows claiming an unassigned doing task without --force', async () => {
      await store.add(makeTask('task-unassigned', { state: 'doing' }))
      const claimed = await store.claim('task-unassigned', { assignee: 'w1' })
      expect(claimed.assignee).toBe('w1')
    })

    it('sets watcher to the claimant when watch=true', async () => {
      await store.add(makeTask('task-w'))
      const watched = await store.claim('task-w', {
        assignee: 'orchestrator',
        watch: true,
      })
      expect(watched.watcher).toBe('orchestrator')
    })

    it('does not set watcher when watch is omitted', async () => {
      await store.add(makeTask('task-w2'))
      const claimed = await store.claim('task-w2', { assignee: 'w1' })
      expect(claimed.watcher).toBeUndefined()
    })

    it('refuses to claim a task in review, ready, or merged', async () => {
      await store.add(makeTask('task-r', { state: 'review' }))
      await store.add(makeTask('task-rd', { state: 'ready' }))
      await store.add(makeTask('task-m', { state: 'merged' }))
      await expect(store.claim('task-r', { assignee: 'w1' })).rejects.toThrow(
        /reopen/
      )
      await expect(store.claim('task-rd', { assignee: 'w1' })).rejects.toThrow(
        /reopen/
      )
      await expect(store.claim('task-m', { assignee: 'w1' })).rejects.toThrow(
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
      await store.update(
        'task-c',
        { state: 'merged', humanTested: true },
        { actor: 'w1' }
      )
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

  describe('labels', () => {
    it('persists labels and filters by them (AND across labels)', async () => {
      await store.add(
        makeTask('task-l1', { labels: ['awaiting-code-review', 'backend'] })
      )
      await store.add(makeTask('task-l2', { labels: ['backend'] }))
      await store.add(makeTask('task-l3'))
      expect((await store.get('task-l1'))!.labels).toEqual([
        'awaiting-code-review',
        'backend',
      ])
      const backend = await store.list({ labels: ['backend'] })
      expect(backend.map((t) => t.id).sort()).toEqual(['task-l1', 'task-l2'])
      const both = await store.list({
        labels: ['backend', 'awaiting-code-review'],
      })
      expect(both.map((t) => t.id)).toEqual(['task-l1'])
    })

    it('adds and removes labels atomically without clobbering', async () => {
      await store.add(makeTask('task-l4', { labels: ['a', 'b'] }))
      const updated = await store.update(
        'task-l4',
        { addLabels: ['c'], removeLabels: ['a'] },
        { actor: 'w' }
      )
      expect(updated.labels!.sort()).toEqual(['b', 'c'])
    })

    it('replacing with an empty array clears labels', async () => {
      await store.add(makeTask('task-l5', { labels: ['x'] }))
      const updated = await store.update(
        'task-l5',
        { labels: [] },
        { actor: 'w' }
      )
      expect(updated.labels).toBeUndefined()
    })

    it('dedupes labels at build time', () => {
      const t = buildTask({
        title: 'x',
        project: 'demo',
        labels: ['a', 'a', 'b'],
      })
      expect(t.labels).toEqual(['a', 'b'])
    })
  })

  describe('event kinds', () => {
    it('tags comment, escalate, and resolve events by kind', async () => {
      await store.add(makeTask('task-k'))
      const commented = await store.comment('task-k', {
        actor: 'qa',
        note: 'a question',
      })
      expect(commented.history.at(-1)).toMatchObject({
        kind: 'comment',
        note: 'a question',
      })
      const escalated = await store.escalate('task-k', {
        actor: 'qa',
        note: 'need creds',
      })
      expect(escalated.history.at(-1)).toMatchObject({ kind: 'escalate' })
      const resolved = await store.resolve('task-k', { actor: 'lead' })
      expect(resolved.history.at(-1)).toMatchObject({ kind: 'resolve' })
    })

    it('rejects an empty comment', async () => {
      await store.add(makeTask('task-k2'))
      await expect(store.comment('task-k2', { note: '  ' })).rejects.toThrow(
        /comment message is required/
      )
    })

    it('leaves transition events without a kind', async () => {
      await store.add(makeTask('task-k3'))
      const moved = await store.update(
        'task-k3',
        { state: 'doing' },
        { actor: 'w' }
      )
      expect(moved.history.at(-1)!.kind).toBeUndefined()
    })
  })

  describe('human checkpoints', () => {
    it('sets reviewed and tested independently, and they accumulate', async () => {
      await store.add(makeTask('task-h1'))
      const r = await store.update(
        'task-h1',
        { humanReviewed: true },
        { actor: 'lead' }
      )
      expect(r.humanReviewed).toBe(true)
      expect(r.humanTested).toBeUndefined()
      const t = await store.update(
        'task-h1',
        { humanTested: true },
        { actor: 'lead' }
      )
      expect(t.humanReviewed).toBe(true)
      expect(t.humanTested).toBe(true)
    })

    it('records a flag-only change in the history', async () => {
      await store.add(makeTask('task-h2'))
      const t = await store.update(
        'task-h2',
        { humanTested: true },
        { actor: 'lead' }
      )
      expect(t.history.at(-1)).toMatchObject({ note: 'marked human-tested' })
      expect(t.history.at(-1)!.to).toBeUndefined()
    })

    it('refuses to mark a reviewed task merged unless human-tested', async () => {
      await store.add(makeTask('task-h3'))
      await store.update(
        'task-h3',
        { state: 'review' },
        { actor: 'w', note: 'ready' }
      )
      await expect(
        store.update('task-h3', { state: 'merged' }, { actor: 'lead' })
      ).rejects.toThrow(/never human-tested/)
    })

    it('lets a reviewed task reach ready without a test', async () => {
      await store.add(makeTask('task-h3a', { state: 'review' }))
      const ready = await store.update(
        'task-h3a',
        { state: 'ready' },
        { actor: 'lead' }
      )
      expect(ready.state).toBe('ready')
      expect(ready.humanTested).toBeUndefined()
    })

    it('lets a never-reviewed task reach merged without a test', async () => {
      await store.add(makeTask('task-h3b'))
      await store.update('task-h3b', { state: 'doing' }, { actor: 'w' })
      const merged = await store.update(
        'task-h3b',
        { state: 'merged' },
        { actor: 'w' }
      )
      expect(merged.state).toBe('merged')
      expect(merged.humanTested).toBeUndefined()
    })

    it('allows merged when tested in the same call', async () => {
      await store.add(makeTask('task-h4', { state: 'review' }))
      const merged = await store.update(
        'task-h4',
        { state: 'merged', humanTested: true },
        { actor: 'lead' }
      )
      expect(merged.state).toBe('merged')
      expect(merged.humanTested).toBe(true)
    })

    it('keeps tested set when a task goes back to review', async () => {
      await store.add(makeTask('task-h5', { state: 'review' }))
      await store.update('task-h5', { humanTested: true }, { actor: 'lead' })
      const back = await store.update(
        'task-h5',
        { state: 'todo' },
        { actor: 'lead', note: 'one more fix' }
      )
      expect(back.state).toBe('todo')
      expect(back.humanTested).toBe(true) // the fact survives the send-back
    })

    it('lets a human clear a checkpoint', async () => {
      await store.add(makeTask('task-h6'))
      await store.update('task-h6', { humanTested: true }, { actor: 'lead' })
      const cleared = await store.update(
        'task-h6',
        { humanTested: false },
        { actor: 'lead' }
      )
      expect(cleared.humanTested).toBeUndefined()
      expect(cleared.history.at(-1)).toMatchObject({
        note: 'cleared human-tested',
      })
    })
  })

  describe('legacy state migration', () => {
    // Tasks stored before the rename carry the terminal state `done`; it must
    // hydrate as `merged` so old data keeps working under the current State union.
    it('hydrates a stored legacy `done` task as `merged`', async () => {
      const legacy = {
        ...makeTask('task-legacy'),
        state: 'done',
        history: [
          { at: new Date().toISOString(), actor: 'w', to: 'done', note: 'qa' },
        ],
      } as unknown as Task
      await store.add(legacy)

      const got = await store.get('task-legacy')
      expect(got!.state).toBe('merged')
      expect(got!.history.at(-1)!.to).toBe('merged')

      const listed = await store.list({ project: 'demo' })
      expect(listed.find((t) => t.id === 'task-legacy')!.state).toBe('merged')
    })
  })
})

describe('expectedState guard', () => {
  let dir: string
  let store: SqliteTaskStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-guard-'))
    store = new SqliteTaskStore(dir)
  })

  afterEach(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('succeeds when the task state matches expectedState', async () => {
    const task = makeTask('task-guard-ok', { state: 'doing' })
    await store.add(task)
    await expect(
      store.update(
        'task-guard-ok',
        { state: 'review', expectedState: 'doing' },
        {}
      )
    ).resolves.toMatchObject({ state: 'review' })
  })

  it('rejects the transition when state does not match expectedState', async () => {
    const task = makeTask('task-guard-fail', { state: 'todo' })
    await store.add(task)
    await expect(
      store.update(
        'task-guard-fail',
        { state: 'review', expectedState: 'doing' },
        {}
      )
    ).rejects.toThrow('State mismatch')
  })

  it('leaves the task unchanged after a rejected transition', async () => {
    const task = makeTask('task-guard-unchanged', { state: 'todo' })
    await store.add(task)
    await store
      .update(
        'task-guard-unchanged',
        { state: 'review', expectedState: 'doing' },
        {}
      )
      .catch(() => {})
    const after = await store.get('task-guard-unchanged')
    expect(after!.state).toBe('todo')
    expect(after!.history).toHaveLength(1)
  })
})

describe('project config, skills, and evidence gates', () => {
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

  it('returns null for an unconfigured project and round-trips a set config', async () => {
    expect(await store.getConfig('demo')).toBeNull()
    await store.setConfig({
      project: 'demo',
      requirePlaybook: true,
      readyGates: ['qa-manual-tested'],
    })
    expect(await store.getConfig('demo')).toMatchObject({
      project: 'demo',
      requirePlaybook: true,
      readyGates: ['qa-manual-tested'],
    })
  })

  it('applies project defaultSkills to a new task that has none', async () => {
    await store.setConfig({ project: 'demo', defaultSkills: ['migrate'] })
    await store.add(makeTask('task-def'))
    expect((await store.get('task-def'))!.skills).toEqual(['migrate'])
  })

  it('does not override a task that brings its own skills', async () => {
    await store.setConfig({ project: 'demo', defaultSkills: ['migrate'] })
    await store.add(makeTask('task-own', { skills: ['custom'] }))
    expect((await store.get('task-own'))!.skills).toEqual(['custom'])
  })

  it('rejects claiming a playbook-required task with no skill', async () => {
    await store.setConfig({ project: 'demo', requirePlaybook: true })
    await store.add(makeTask('task-np'))
    await expect(
      store.claim('task-np', { assignee: 'drainer' })
    ).rejects.toThrow('needs a playbook')
  })

  it('allows claiming when project defaults supply the playbook', async () => {
    await store.setConfig({
      project: 'demo',
      requirePlaybook: true,
      defaultSkills: ['migrate'],
    })
    await store.add(makeTask('task-dflt'))
    await expect(
      store.claim('task-dflt', { assignee: 'drainer' })
    ).resolves.toMatchObject({ state: 'doing' })
  })

  it('blocks review → ready until required gates carry evidence', async () => {
    await store.setConfig({
      project: 'demo',
      readyGates: ['qa-code-reviewed', 'qa-manual-tested'],
    })
    await store.add(makeTask('task-g', { state: 'review' }))
    await expect(
      store.update('task-g', { state: 'ready' }, {})
    ).rejects.toThrow('missing evidence gate')
    await store.update(
      'task-g',
      { setGate: { key: 'qa-code-reviewed', evidence: 'pr#1' } },
      { actor: 'qa' }
    )
    await expect(
      store.update('task-g', { state: 'ready' }, {})
    ).rejects.toThrow('qa-manual-tested')
    await store.update(
      'task-g',
      { setGate: { key: 'qa-manual-tested', evidence: 'shot.png' } },
      { actor: 'qa' }
    )
    const ready = await store.update('task-g', { state: 'ready' }, {})
    expect(ready.state).toBe('ready')
    expect(ready.gates!['qa-manual-tested'].evidence).toBe('shot.png')
  })

  it('leaves review → ready unchanged when no config is set (back-compat)', async () => {
    await store.add(makeTask('task-bc', { state: 'review' }))
    await expect(
      store.update('task-bc', { state: 'ready' }, {})
    ).resolves.toMatchObject({ state: 'ready' })
  })
})
