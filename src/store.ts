import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import type { State, Task, TaskChanges, TaskEvent } from "./types.js";
import { requiresNote } from "./types.js";
import { dataDir, generateId } from "./util.js";

function validateId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || id.length > 64) {
    throw new Error("Invalid task id");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Bounded retry past busy_timeout; safe because BEGIN IMMEDIATE commits whole or rolls back.
async function withBusyRetry<T>(run: () => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 4 && /database is locked|SQLITE_BUSY/i.test(msg)) {
        await sleep(20 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

export interface NewTaskInput {
  title: string;
  description?: string;
  plan?: string;
  state?: State;
  project: string;
  branch?: string;
  worktree?: string;
  assignee?: string;
  actor?: string;
  note?: string;
}

// One place both CLI and MCP build a task, so creation can't drift between surfaces.
export function buildTask(input: NewTaskInput): Task {
  if (!input.title.trim()) throw new Error("Task title is required");
  const state = input.state ?? "todo";
  const note = input.note?.trim();
  if (state === "blocked" && !note) {
    throw new Error("A note is required to create a task in 'blocked' (explain why).");
  }
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title: input.title,
    description: input.description || undefined,
    plan: input.plan || undefined,
    state,
    project: input.project,
    branch: input.branch || undefined,
    worktree: input.worktree || undefined,
    assignee: input.assignee || undefined,
    createdBy: input.actor,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, actor: input.actor, to: state, note: note ?? "created" }],
  };
}

// Apply changes in place and append the audit event. Send-backs require a note.
function applyChanges(task: Task, changes: TaskChanges, meta: { actor?: string; note?: string }): void {
  const note = meta.note?.trim();
  const event: TaskEvent = { at: new Date().toISOString() };
  if (meta.actor) event.actor = meta.actor;
  if (note) event.note = note;
  if (changes.state && changes.state !== task.state) {
    if (requiresNote(task.state, changes.state) && !note) {
      throw new Error(
        `A note is required to move ${task.state} → ${changes.state} (explain why you are sending it back).`
      );
    }
    event.from = task.state;
    event.to = changes.state;
    task.state = changes.state;
  }
  if (changes.assignee !== undefined) task.assignee = changes.assignee || undefined;
  if (changes.title) task.title = changes.title; // empty title can't clear a title
  if (changes.description !== undefined) task.description = changes.description || undefined;
  if (changes.plan !== undefined) task.plan = changes.plan || undefined;
  if (changes.branch !== undefined) task.branch = changes.branch || undefined;
  if (changes.worktree !== undefined) task.worktree = changes.worktree || undefined;
  task.updatedAt = event.at;
  task.history.push(event);
}

export interface TaskFilter {
  state?: string;
  assignee?: string;
  project?: string;
  since?: string; // ISO; keeps tasks with updatedAt >= since
}

export interface ClaimInput {
  assignee: string;
  actor?: string;
  note?: string;
  branch?: string;
  worktree?: string;
}

export interface TaskStore {
  add(task: Task): Promise<void>;
  get(id: string): Promise<Task | null>;
  list(filter?: TaskFilter): Promise<Task[]>;
  update(id: string, changes: TaskChanges, meta: { actor?: string; note?: string }): Promise<Task>;
  claim(id: string, input: ClaimInput): Promise<Task>;
}

interface Row {
  data: string;
}

// SQLite serializes writers (IMMEDIATE transaction + busy_timeout), so concurrent updates —
// same process or across agents — can't drop a history entry. No lockfiles.
export class SqliteTaskStore implements TaskStore {
  private db: Database;

  constructor(dir?: string) {
    const base = dir ?? dataDir();
    fs.mkdirSync(base, { recursive: true });
    this.db = new Database(path.join(base, "tasks.db"));
    // busy_timeout first: it must cover the WAL switch and DDL below, which take write locks
    // and would otherwise throw "database is locked" under concurrent first-time construction.
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        assignee TEXT,
        project TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      )`
    );
  }

  close(): void {
    this.db.close();
  }

  async add(task: Task): Promise<void> {
    validateId(task.id);
    try {
      await withBusyRetry(() => this.insertRow(task));
    } catch (err) {
      if (/UNIQUE|constraint/i.test(String(err))) throw new Error(`Task "${task.id}" already exists`);
      throw err;
    }
  }

  async get(id: string): Promise<Task | null> {
    validateId(id);
    return this.readRow(id);
  }

  async list(filter: TaskFilter = {}): Promise<Task[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.state) (where.push("state = ?"), params.push(filter.state));
    if (filter.assignee) (where.push("assignee = ?"), params.push(filter.assignee));
    if (filter.project) (where.push("project = ?"), params.push(filter.project));
    if (filter.since !== undefined) {
      const since = new Date(filter.since);
      if (isNaN(since.getTime())) throw new Error(`Invalid since timestamp: ${filter.since}`);
      where.push("updated_at >= ?");
      params.push(since.toISOString()); // canonical form so the string compare matches stored rows
    }
    const sql =
      "SELECT data FROM tasks" +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY updated_at DESC, id DESC";
    const rows = this.db.query(sql).all(...params) as Row[];
    return rows.map((r) => JSON.parse(r.data) as Task);
  }

  async update(
    id: string,
    changes: TaskChanges,
    meta: { actor?: string; note?: string }
  ): Promise<Task> {
    validateId(id);
    return withBusyRetry(() =>
      this.db
        .transaction(() => {
          const task = this.readRow(id);
          if (!task) throw new Error(`Task "${id}" not found`);
          applyChanges(task, changes, meta);
          this.writeRow(task);
          return task;
        })
        .immediate()
    );
  }

  async claim(id: string, input: ClaimInput): Promise<Task> {
    validateId(id);
    return withBusyRetry(() =>
      this.db
        .transaction(() => {
          const task = this.readRow(id);
          if (!task) throw new Error(`Task "${id}" not found`);
          if (task.state === "review" || task.state === "done") {
            throw new Error(
              `Task is in '${task.state}'; reopen deliberately with: update ${id} --state doing --note "<why>"`
            );
          }
          applyChanges(
            task,
            { assignee: input.assignee, state: "doing", branch: input.branch, worktree: input.worktree },
            { actor: input.actor, note: input.note ?? "claimed" }
          );
          this.writeRow(task);
          return task;
        })
        .immediate()
    );
  }

  private readRow(id: string): Task | null {
    const row = this.db.query("SELECT data FROM tasks WHERE id = ?").get(id) as Row | null;
    return row ? (JSON.parse(row.data) as Task) : null;
  }

  // add() must fail on a duplicate id, never clobber an existing task's history.
  private insertRow(task: Task): void {
    this.row("INSERT INTO tasks", task);
  }

  // update()/claim() rewrite a row they just read inside the same transaction.
  private writeRow(task: Task): void {
    this.row("INSERT OR REPLACE INTO tasks", task);
  }

  private row(verb: string, task: Task): void {
    this.db
      .query(`${verb} (id, state, assignee, project, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(task.id, task.state, task.assignee ?? null, task.project, task.updatedAt, JSON.stringify(task));
  }
}
