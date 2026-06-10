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

// Poll one link; if its summary changed, record it on the thread + tag it, and
// return the updated task. Returns null when there's no connector or no change.
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
  return store.update(
    id,
    {
      addLink: { ...link, lastStatus: status.summary },
      addLabels: statusLabels(status),
    },
    { actor, note: `${link.system} ${link.kind}: ${status.summary}` }
  )
}
