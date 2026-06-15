import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SqliteTaskStore } from '../store.js'
import { buildTask } from '../store.js'
import { registerConnector, syncLink } from './index.js'
import type { RemoteStatus } from './types.js'

// A fake connector whose status the test controls, so no network or gh is touched.
let nextStatus: RemoteStatus | null = null
registerConnector({
  system: 'fake',
  async poll() {
    return nextStatus
  },
})

describe('syncLink', () => {
  let dir: string
  let store: SqliteTaskStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sync-'))
    store = new SqliteTaskStore(dir)
  })
  afterEach(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  async function seed(state: 'todo' | 'review' | 'ready' = 'todo') {
    const task = buildTask({ title: 'has a PR', project: 'demo', state })
    task.links = [{ system: 'fake', kind: 'pr', ref: 'o/r#1' }]
    await store.add(task)
    return task.id
  }

  it('records a changed status as a note + labels and stores lastStatus', async () => {
    const id = await seed()
    nextStatus = {
      reviewDecision: 'CHANGES_REQUESTED',
      checks: 'fail',
      merged: false,
      summary: 'OPEN CHANGES_REQUESTED checks:fail',
    }
    const updated = await syncLink(store, id, {
      system: 'fake',
      kind: 'pr',
      ref: 'o/r#1',
    })
    expect(updated).not.toBeNull()
    expect(updated!.history.at(-1)!.note).toContain('CHANGES_REQUESTED')
    expect(updated!.labels!.sort()).toEqual(['changes-requested', 'ci-failed'])
    expect(updated!.links![0].lastStatus).toBe(
      'OPEN CHANGES_REQUESTED checks:fail'
    )
  })

  it('is a no-op when the status is unchanged', async () => {
    const id = await seed()
    nextStatus = { merged: true, summary: 'MERGED' }
    const first = await syncLink(store, id, {
      system: 'fake',
      kind: 'pr',
      ref: 'o/r#1',
    })
    expect(first).not.toBeNull()
    // poll again with the now-stored lastStatus
    const link = first!.links![0]
    const second = await syncLink(store, id, link)
    expect(second).toBeNull()
  })

  describe('state driving (review/ready tasks)', () => {
    it('sends task back to todo on CHANGES_REQUESTED', async () => {
      const id = await seed('review')
      nextStatus = {
        reviewDecision: 'CHANGES_REQUESTED',
        checks: 'pass',
        merged: false,
        summary: 'OPEN CHANGES_REQUESTED checks:pass',
      }
      const updated = await syncLink(store, id, {
        system: 'fake',
        kind: 'pr',
        ref: 'o/r#1',
      })
      expect(updated!.state).toBe('todo')
      expect(updated!.history.at(-1)!.note).toContain('Changes requested')
      expect(updated!.labels).toContain('changes-requested')
    })

    it('escalates (needsHuman) on CI failure', async () => {
      const id = await seed('review')
      nextStatus = {
        reviewDecision: undefined,
        checks: 'fail',
        merged: false,
        summary: 'OPEN checks:fail',
      }
      const updated = await syncLink(store, id, {
        system: 'fake',
        kind: 'pr',
        ref: 'o/r#1',
      })
      expect(updated!.needsHuman).toBe(true)
      expect(updated!.history.at(-1)!.note).toContain('CI failing')
    })

    it('moves to ready when approved + CI green', async () => {
      const id = await seed('review')
      nextStatus = {
        reviewDecision: 'APPROVED',
        checks: 'pass',
        merged: false,
        summary: 'OPEN APPROVED checks:pass',
      }
      const updated = await syncLink(store, id, {
        system: 'fake',
        kind: 'pr',
        ref: 'o/r#1',
      })
      expect(updated!.state).toBe('ready')
      expect(updated!.history.at(-1)!.note).toBe('PR approved, CI green')
    })

    it('moves to merged when PR is merged', async () => {
      const id = await seed('ready')
      nextStatus = {
        reviewDecision: 'APPROVED',
        checks: 'pass',
        merged: true,
        summary: 'MERGED',
      }
      const updated = await syncLink(store, id, {
        system: 'fake',
        kind: 'pr',
        ref: 'o/r#1',
      })
      expect(updated!.state).toBe('merged')
      expect(updated!.humanTested).toBe(true)
      expect(updated!.history.at(-1)!.note).toContain('PR merged')
    })

    it('does not drive state for tasks in todo/doing', async () => {
      const id = await seed('todo')
      nextStatus = {
        reviewDecision: 'APPROVED',
        checks: 'pass',
        merged: false,
        summary: 'OPEN APPROVED checks:pass',
      }
      const updated = await syncLink(store, id, {
        system: 'fake',
        kind: 'pr',
        ref: 'o/r#1',
      })
      // should fall back to label-only update, not move to ready
      expect(updated!.state).toBe('todo')
      expect(updated!.history.at(-1)!.note).toContain('fake pr')
    })

    it('CHANGES_REQUESTED takes priority over CI failure', async () => {
      const id = await seed('review')
      nextStatus = {
        reviewDecision: 'CHANGES_REQUESTED',
        checks: 'fail',
        merged: false,
        summary: 'OPEN CHANGES_REQUESTED checks:fail',
      }
      const updated = await syncLink(store, id, {
        system: 'fake',
        kind: 'pr',
        ref: 'o/r#1',
      })
      expect(updated!.state).toBe('todo')
    })
  })
})
