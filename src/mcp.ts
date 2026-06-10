import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { buildTask, type TaskStore } from './store.js'
import { STATES, type Task } from './types.js'
import { detectProject, gitContext } from './util.js'
import { VERSION } from './version.js'
import { syncLink } from './connectors/index.js'

const StateEnum = z.enum(STATES)

function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

function fail(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function err(e: unknown): CallToolResult {
  return fail(e instanceof Error ? e.message : String(e))
}

function summarize(task: Task): string {
  return `${task.id} [${task.state}] ${task.title} — assignee: ${task.assignee ?? '—'}, project: ${task.project}`
}

export function registerTools(server: McpServer, store: TaskStore): void {
  server.registerTool(
    'add_task',
    {
      title: 'Log a task',
      description:
        "Log a task for an agent or person to pick up. State starts at 'todo' unless set. A task created directly in 'blocked' requires a note.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional().describe('What is being done'),
        plan: z.string().optional().describe('Approach / steps'),
        assignee: z.string().optional(),
        project: z
          .string()
          .optional()
          .describe('Defaults to the current git repo name'),
        branch: z.string().optional(),
        worktree: z.string().optional(),
        state: StateEnum.optional(),
        labels: z
          .array(z.string())
          .optional()
          .describe('Free-form tags, e.g. awaiting-code-review'),
        actor: z.string().optional().describe('Who is logging this task'),
        note: z
          .string()
          .optional()
          .describe('Rationale for the creation event'),
      }),
    },
    async (input): Promise<CallToolResult> => {
      try {
        const task = buildTask({
          ...input,
          project: input.project ?? detectProject(),
        })
        await store.add(task)
        return ok(`Logged ${summarize(task)}`)
      } catch (e) {
        return err(e)
      }
    }
  )

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        "List tasks, newest-updated first. Poll with state='review' to find work waiting for QA. Use 'since' (ISO) to see only what changed recently.",
      inputSchema: z.object({
        state: StateEnum.optional(),
        assignee: z.string().optional(),
        project: z
          .string()
          .optional()
          .describe('Omit to list across all projects'),
        since: z
          .string()
          .optional()
          .describe('ISO timestamp; only tasks updated at/after it'),
        needsHuman: z
          .boolean()
          .optional()
          .describe('Only tasks escalated to a human'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Keep tasks carrying every one of these labels'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (filter): Promise<CallToolResult> => {
      const tasks = await store.list(filter)
      if (tasks.length === 0) return ok('No tasks match.')
      const lines = tasks.map((t) => `${summarize(t)} (updated ${t.updatedAt})`)
      return ok(`${tasks.length} task(s):\n${lines.join('\n')}`)
    }
  )

  server.registerTool(
    'get_task',
    {
      title: 'Get a task',
      description: 'Fetch one task with its full state-transition history.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const task = await store.get(id)
        if (!task) return fail(`Task "${id}" not found.`)
        return ok(JSON.stringify(task, null, 2))
      } catch (e) {
        return err(e)
      }
    }
  )

  server.registerTool(
    'update_task',
    {
      title: 'Update a task',
      description:
        "Change fields and/or state and append a note to the history. To hand off for QA set state='review'. After QA passes set state='ready' (awaiting the human's review and merge); 'merged' is terminal. To reject after QA set state='doing' with a note. A task that has been in review cannot reach state='merged' unless humanTested is true (pass humanTested in the same call). Pass an empty string to clear assignee/description.",
      inputSchema: z.object({
        id: z.string(),
        state: StateEnum.optional(),
        assignee: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        plan: z.string().optional(),
        branch: z.string().optional(),
        worktree: z.string().optional(),
        labels: z
          .array(z.string())
          .optional()
          .describe('Replace the whole set'),
        addLabels: z.array(z.string()).optional(),
        removeLabels: z.array(z.string()).optional(),
        humanReviewed: z
          .boolean()
          .optional()
          .describe('Set/clear the human-reviewed checkpoint'),
        humanTested: z
          .boolean()
          .optional()
          .describe(
            'Set/clear the human-tested checkpoint; required for merged'
          ),
        note: z.string().optional(),
        actor: z.string().optional(),
      }),
    },
    async ({ id, note, actor, ...changes }): Promise<CallToolResult> => {
      try {
        const task = await store.update(id, changes, { actor, note })
        return ok(`Updated ${summarize(task)}`)
      } catch (e) {
        return err(e)
      }
    }
  )

  server.registerTool(
    'escalate_task',
    {
      title: 'Escalate to a human',
      description:
        'Flag a task as needing a human (orthogonal to its state). The note must say what you need. Find these with list_tasks({ needsHuman: true }).',
      inputSchema: z.object({
        id: z.string(),
        note: z.string().describe('What you need from a human'),
        actor: z.string().optional(),
      }),
    },
    async ({ id, note, actor }): Promise<CallToolResult> => {
      try {
        const task = await store.escalate(id, { actor, note })
        return ok(`Escalated ${summarize(task)}`)
      } catch (e) {
        return err(e)
      }
    }
  )

  server.registerTool(
    'comment_task',
    {
      title: 'Comment on a task',
      description:
        'Leave a note on the task thread without changing its state. Use it for back-and-forth between agents (questions, context, answers).',
      inputSchema: z.object({
        id: z.string(),
        note: z.string().describe('The message to add to the thread'),
        actor: z.string().optional(),
      }),
    },
    async ({ id, note, actor }): Promise<CallToolResult> => {
      try {
        const task = await store.comment(id, { actor, note })
        return ok(`Commented on ${summarize(task)}`)
      } catch (e) {
        return err(e)
      }
    }
  )

  server.registerTool(
    'resolve_task',
    {
      title: 'Clear needs-human',
      description: 'Clear the needs-human flag once a human has handled it.',
      inputSchema: z.object({
        id: z.string(),
        note: z.string().optional(),
        actor: z.string().optional(),
      }),
    },
    async ({ id, note, actor }): Promise<CallToolResult> => {
      try {
        const task = await store.resolve(id, { actor, note })
        return ok(`Resolved ${summarize(task)}`)
      } catch (e) {
        return err(e)
      }
    }
  )

  server.registerTool(
    'claim_task',
    {
      title: 'Claim a task',
      description:
        "Assign a task to yourself and move it to 'doing'. Tasks already in 'review', 'ready', or 'merged' must be reopened deliberately via update_task with a note, not claimed.",
      inputSchema: z.object({
        id: z.string(),
        assignee: z.string().describe('Actor id claiming the task'),
        branch: z.string().optional(),
        worktree: z.string().optional(),
        note: z.string().optional(),
      }),
    },
    async ({
      id,
      assignee,
      branch,
      worktree,
      note,
    }): Promise<CallToolResult> => {
      try {
        const git = gitContext()
        const task = await store.claim(id, {
          assignee,
          actor: assignee,
          note,
          branch: branch ?? git.branch,
          worktree: worktree ?? git.worktree,
        })
        return ok(`Claimed ${summarize(task)}`)
      } catch (e) {
        return err(e)
      }
    }
  )

  server.registerTool(
    'sync_task',
    {
      title: 'Sync a task with its remote links',
      description:
        'Poll each linked remote (e.g. a GitHub PR) and, when its status changed, record it on the task thread and tag it (changes-requested / ci-failed / merged). Needs the gh CLI.',
      inputSchema: z.object({ id: z.string(), actor: z.string().optional() }),
    },
    async ({ id, actor }): Promise<CallToolResult> => {
      try {
        const task = await store.get(id)
        if (!task) return fail(`Task "${id}" not found.`)
        if (!task.links?.length) return ok(`No links on ${id}.`)
        let changes = 0
        for (const link of task.links) {
          if (await syncLink(store, id, link, actor)) changes++
        }
        return ok(`Synced ${id}: ${changes} change(s).`)
      } catch (e) {
        return err(e)
      }
    }
  )
}

export function createServer(store: TaskStore): McpServer {
  const server = new McpServer({ name: 'relay', version: VERSION })
  registerTools(server, store)
  return server
}
