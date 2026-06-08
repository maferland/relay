import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { buildTask, type TaskStore } from "./store.js";
import { STATES, type Task } from "./types.js";
import { detectProject, gitContext } from "./util.js";

const StateEnum = z.enum(STATES);

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function err(e: unknown): CallToolResult {
  return fail(e instanceof Error ? e.message : String(e));
}

function summarize(task: Task): string {
  return `${task.id} [${task.state}] ${task.title} — assignee: ${task.assignee ?? "—"}, project: ${task.project}`;
}

export function registerTools(server: McpServer, store: TaskStore): void {
  server.registerTool(
    "add_task",
    {
      title: "Log a task",
      description:
        "Log a task for an agent or person to pick up. State starts at 'todo' unless set. A task created directly in 'blocked' requires a note.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional().describe("What is being done"),
        plan: z.string().optional().describe("Approach / steps"),
        assignee: z.string().optional(),
        project: z.string().optional().describe("Defaults to the current git repo name"),
        branch: z.string().optional(),
        worktree: z.string().optional(),
        state: StateEnum.optional(),
        actor: z.string().optional().describe("Who is logging this task"),
        note: z.string().optional().describe("Rationale for the creation event"),
      }),
    },
    async (input): Promise<CallToolResult> => {
      try {
        const task = buildTask({ ...input, project: input.project ?? detectProject() });
        await store.add(task);
        return ok(`Logged ${summarize(task)}`);
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List tasks, newest-updated first. Poll with state='review' to find work waiting for QA. Use 'since' (ISO) to see only what changed recently.",
      inputSchema: z.object({
        state: StateEnum.optional(),
        assignee: z.string().optional(),
        project: z.string().optional().describe("Omit to list across all projects"),
        since: z.string().optional().describe("ISO timestamp; only tasks updated at/after it"),
      }),
      annotations: { readOnlyHint: true },
    },
    async (filter): Promise<CallToolResult> => {
      const tasks = await store.list(filter);
      if (tasks.length === 0) return ok("No tasks match.");
      const lines = tasks.map((t) => `${summarize(t)} (updated ${t.updatedAt})`);
      return ok(`${tasks.length} task(s):\n${lines.join("\n")}`);
    }
  );

  server.registerTool(
    "get_task",
    {
      title: "Get a task",
      description: "Fetch one task with its full state-transition history.",
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const task = await store.get(id);
        if (!task) return fail(`Task "${id}" not found.`);
        return ok(JSON.stringify(task, null, 2));
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      title: "Update a task",
      description:
        "Change fields and/or state and append a note to the history. To hand off for QA set state='review'. To reject after QA set state='doing' with a note. Pass an empty string to clear assignee/description.",
      inputSchema: z.object({
        id: z.string(),
        state: StateEnum.optional(),
        assignee: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        plan: z.string().optional(),
        branch: z.string().optional(),
        worktree: z.string().optional(),
        note: z.string().optional(),
        actor: z.string().optional(),
      }),
    },
    async ({ id, note, actor, ...changes }): Promise<CallToolResult> => {
      try {
        const task = await store.update(id, changes, { actor, note });
        return ok(`Updated ${summarize(task)}`);
      } catch (e) {
        return err(e);
      }
    }
  );

  server.registerTool(
    "claim_task",
    {
      title: "Claim a task",
      description:
        "Assign a task to yourself and move it to 'doing'. Tasks already in 'review' or 'done' must be reopened deliberately via update_task with a note, not claimed.",
      inputSchema: z.object({
        id: z.string(),
        assignee: z.string().describe("Actor id claiming the task"),
        branch: z.string().optional(),
        worktree: z.string().optional(),
        note: z.string().optional(),
      }),
    },
    async ({ id, assignee, branch, worktree, note }): Promise<CallToolResult> => {
      try {
        const git = gitContext();
        const task = await store.claim(id, {
          assignee,
          actor: assignee,
          note,
          branch: branch ?? git.branch,
          worktree: worktree ?? git.worktree,
        });
        return ok(`Claimed ${summarize(task)}`);
      } catch (e) {
        return err(e);
      }
    }
  );
}

export function createServer(store: TaskStore): McpServer {
  const server = new McpServer({ name: "agent-tasks", version: "0.1.0" });
  registerTools(server, store);
  return server;
}
