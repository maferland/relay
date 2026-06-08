// `review` is the QA-handoff signal a coordinator polls for.
export const STATES = ["todo", "doing", "review", "done", "blocked"] as const;
export type State = (typeof STATES)[number];

export function isState(value: string): value is State {
  return (STATES as readonly string[]).includes(value);
}

const RANK: Record<State, number> = { todo: 0, doing: 1, review: 2, done: 3, blocked: -1 };

// Send-backs must explain themselves: any backward move (e.g. review → todo) or
// a move to `blocked` requires a note so the next actor knows why.
export function requiresNote(from: State, to: State): boolean {
  if (from === to || from === "blocked") return false;
  if (to === "blocked") return true;
  return RANK[to] < RANK[from];
}

export interface TaskEvent {
  at: string;
  actor?: string;
  from?: State;
  to?: State;
  note?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string; // what is being done
  plan?: string; // approach / steps
  state: State;
  project: string; // main repo name, stable across worktrees
  branch?: string; // git branch the work happens on
  worktree?: string; // worktree dir the work happens in
  assignee?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string; // drives `--since` filtering
  history: TaskEvent[];
}

export interface TaskChanges {
  state?: State;
  assignee?: string;
  title?: string;
  description?: string;
  plan?: string;
  branch?: string;
  worktree?: string;
}
