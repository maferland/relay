import type { Snapshot, State, UiTask } from './types.ts'

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
  return body
}

export async function fetchSnapshot(): Promise<Snapshot> {
  return jsonOrThrow(await fetch('/api/snapshot'))
}

export async function transition(
  id: string,
  to: State,
  note: string
): Promise<UiTask> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to, note }),
  })
  return (await jsonOrThrow(res)) as UiTask
}

export async function escalate(id: string, note: string): Promise<UiTask> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/escalate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note }),
  })
  return (await jsonOrThrow(res)) as UiTask
}

export async function resolve(id: string, note: string): Promise<UiTask> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note }),
  })
  return (await jsonOrThrow(res)) as UiTask
}

// Long-poll: resolves when something changed at/after `since`, or after the server's timeout.
export async function pollChanges(
  since: number,
  signal: AbortSignal
): Promise<{ tasks: UiTask[]; now: number }> {
  const res = await fetch(`/api/changes?since=${since}`, { signal })
  return (await jsonOrThrow(res)) as { tasks: UiTask[]; now: number }
}
