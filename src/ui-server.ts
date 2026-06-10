import { buildTask, type SqliteTaskStore } from './store.js'
import type { State, Task, TaskChanges } from './types.js'
import { isState } from './types.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const CHANGES_TIMEOUT_MS = 25_000

function ms(iso: string): number {
  return new Date(iso).getTime()
}

function initials(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean)
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return s.toUpperCase()
}

// Time the checkpoint was last set (latest history note that records it), so the UI can flag it stale.
function checkpointAt(task: Task, marker: string): number | undefined {
  for (let i = task.history.length - 1; i >= 0; i--) {
    const note = task.history[i].note
    if (note?.includes(marker)) return ms(task.history[i].at)
  }
  return undefined
}

function adapt(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    plan: task.plan,
    state: task.state,
    project: task.project,
    branch: task.branch,
    worktree: task.worktree,
    needsHuman: task.needsHuman,
    humanReviewed: task.humanReviewed,
    humanTested: task.humanTested,
    reviewedAt: task.humanReviewed
      ? checkpointAt(task, 'marked human-reviewed')
      : undefined,
    testedAt: task.humanTested
      ? checkpointAt(task, 'marked human-tested')
      : undefined,
    labels: task.labels ?? [],
    links: task.links ?? [],
    assignee: task.assignee,
    createdBy: task.createdBy,
    createdAt: ms(task.createdAt),
    updatedAt: ms(task.updatedAt),
    history: task.history.map((e) => ({
      at: ms(e.at),
      actor: e.actor ?? 'unknown',
      from: e.from ?? null,
      to: e.to ?? null,
      note: e.note ?? '',
      kind: e.kind ?? null,
    })),
  }
}

function actorsFrom(tasks: Task[], me: string) {
  const names = new Set<string>([me])
  for (const t of tasks) {
    if (t.assignee) names.add(t.assignee)
    if (t.createdBy) names.add(t.createdBy)
    for (const e of t.history) if (e.actor) names.add(e.actor)
  }
  const actors: Record<
    string,
    { name: string; kind: 'human' | 'agent'; short: string }
  > = {}
  for (const name of names) {
    actors[name] = {
      name,
      kind: name === me ? 'human' : 'agent',
      short: initials(name),
    }
  }
  return actors
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface RequestBody {
  to?: string
  note?: string
  title?: string
  description?: string
  project?: string
  assignee?: string
  reviewed?: boolean
  tested?: boolean
}

async function readBody(req: Request): Promise<RequestBody> {
  try {
    return (await req.json()) as RequestBody
  } catch {
    return {}
  }
}

export interface UiServerOptions {
  me: string
  port?: number
  html: string
}

export function createUiServer(store: SqliteTaskStore, opts: UiServerOptions) {
  const { me, html } = opts

  async function snapshot() {
    const tasks = await store.list()
    return {
      me,
      actors: actorsFrom(tasks, me),
      projects: [...new Set(tasks.map((t) => t.project))].sort(),
      tasks: tasks.map(adapt),
    }
  }

  async function changes(sinceMs: number): Promise<Response> {
    const deadline = Date.now() + CHANGES_TIMEOUT_MS
    for (;;) {
      const tasks = await store.list()
      const changed = tasks.filter((t) => ms(t.updatedAt) > sinceMs)
      if (changed.length || Date.now() > deadline) {
        return json({ tasks: changed.map(adapt), now: Date.now() })
      }
      await sleep(500)
    }
  }

  const server = Bun.serve({
    port: opts.port ?? 0,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url)
      const p = url.pathname

      if (p === '/api/snapshot') return json(await snapshot())

      if (p === '/api/changes') {
        return changes(Number(url.searchParams.get('since') ?? '0'))
      }

      if (p === '/api/tasks' && req.method === 'POST') {
        const body = await readBody(req)
        const title = body.title?.trim()
        const project = body.project?.trim()
        if (!title) return json({ error: 'A task title is required' }, 400)
        if (!project) return json({ error: 'A project is required' }, 400)
        try {
          const task = buildTask({
            title,
            description: body.description?.trim() || undefined,
            project,
            assignee: body.assignee?.trim() || undefined,
            actor: me,
          })
          await store.add(task)
          return json(adapt(task), 201)
        } catch (e) {
          return json(
            { error: e instanceof Error ? e.message : String(e) },
            400
          )
        }
      }

      const match = p.match(
        /^\/api\/tasks\/([^/]+)\/(transition|escalate|resolve|comment|checkpoint)$/
      )
      if (match && req.method === 'POST') {
        const id = decodeURIComponent(match[1])
        const action = match[2]
        const body = await readBody(req)
        try {
          if (action === 'transition') {
            if (!body.to || !isState(body.to))
              return json({ error: 'Invalid target state' }, 400)
            const to = body.to as State
            const current = await store.get(id)
            const changes: { state: State; assignee?: string } = { state: to }
            if (to === 'doing' && current && !current.assignee)
              changes.assignee = me
            const updated = await store.update(id, changes, {
              actor: me,
              note: body.note,
            })
            return json(adapt(updated))
          }
          if (action === 'escalate') {
            return json(
              adapt(await store.escalate(id, { actor: me, note: body.note }))
            )
          }
          if (action === 'comment') {
            if (!body.note?.trim())
              return json({ error: 'A comment message is required' }, 400)
            return json(
              adapt(await store.comment(id, { actor: me, note: body.note }))
            )
          }
          if (action === 'checkpoint') {
            const changes: TaskChanges = {}
            if (typeof body.reviewed === 'boolean')
              changes.humanReviewed = body.reviewed
            if (typeof body.tested === 'boolean')
              changes.humanTested = body.tested
            if (
              changes.humanReviewed === undefined &&
              changes.humanTested === undefined
            )
              return json({ error: 'No checkpoint flag to set' }, 400)
            return json(adapt(await store.update(id, changes, { actor: me })))
          }
          return json(
            adapt(await store.resolve(id, { actor: me, note: body.note }))
          )
        } catch (e) {
          return json(
            { error: e instanceof Error ? e.message : String(e) },
            400
          )
        }
      }

      // Everything else → the single-page app.
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    },
  })

  return server
}
