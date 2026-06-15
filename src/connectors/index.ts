import type { TaskStore } from '../store.js'
import type { Task, TaskLink } from '../types.js'
import { githubConnector } from './github.js'
import type { Connector, RemoteStatus } from './types.js'

export type { Connector, RemoteStatus } from './types.js'

const registry = new Map<string, Connector>([
  [githubConnector.system, githubConnector],
])

export function getConnector(system: string): Connector | undefined {
  return registry.get(system)
}

// For tests: register or override a connector (e.g. an injected fake).
export function registerConnector(connector: Connector): void {
  registry.set(connector.system, connector)
}

// Map a remote status onto the labels we tag the task with.
export function statusLabels(s: RemoteStatus): string[] {
  const out: string[] = []
  if (s.reviewDecision === 'CHANGES_REQUESTED') out.push('changes-requested')
  if (s.checks === 'fail') out.push('ci-failed')
  if (s.merged) out.push('merged')
  return out
}

// Drive task state from PR signals. Only acts on tasks in `review` or `ready`.
async function driveTaskState(
  store: TaskStore,
  id: string,
  link: TaskLink,
  status: RemoteStatus,
  actor?: string
): Promise<Task | null> {
  const task = await store.get(id)
  if (!task) return null
  if (task.state !== 'review' && task.state !== 'ready') return null

  if (status.merged) {
    return store.update(
      id,
      {
        state: 'merged',
        addLink: { ...link, lastStatus: status.summary },
        addLabels: statusLabels(status),
        humanTested: true,
      },
      { actor, note: `PR merged: ${link.ref}` }
    )
  }

  if (status.reviewDecision === 'CHANGES_REQUESTED') {
    return store.update(
      id,
      {
        state: 'todo',
        addLink: { ...link, lastStatus: status.summary },
        addLabels: statusLabels(status),
      },
      { actor, note: `Changes requested: ${status.summary}` }
    )
  }

  if (status.checks === 'fail') {
    return store.escalate(id, { actor, note: `CI failing: ${status.summary}` })
  }

  if (status.reviewDecision === 'APPROVED' && status.checks === 'pass') {
    return store.update(
      id,
      {
        state: 'ready',
        addLink: { ...link, lastStatus: status.summary },
        addLabels: statusLabels(status),
      },
      { actor, note: `PR approved, CI green` }
    )
  }

  return null
}

// Poll one link; if its summary changed, drive task state and record it on the thread.
// Returns the updated task, or null when there is no change or no connector.
export async function syncLink(
  store: TaskStore,
  id: string,
  link: TaskLink,
  actor?: string
): Promise<Task | null> {
  const connector = getConnector(link.system)
  if (!connector) return null
  const status = await connector.poll(link)
  if (!status || status.summary === link.lastStatus) return null

  const driven = await driveTaskState(store, id, link, status, actor)
  if (driven) return driven

  // Fallback for tasks not in review/ready, or status not mapped to a transition.
  return store.update(
    id,
    {
      addLink: { ...link, lastStatus: status.summary },
      addLabels: statusLabels(status),
    },
    { actor, note: `${link.system} ${link.kind}: ${status.summary}` }
  )
}
