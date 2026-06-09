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

  async function seed() {
    const task = buildTask({ title: 'has a PR', project: 'demo' })
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
})
