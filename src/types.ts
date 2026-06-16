// `review` is the QA-handoff signal a coordinator polls for; `ready` waits on the human's merge.
export const STATES = [
  'todo',
  'doing',
  'review',
  'ready',
  'merged',
  'blocked',
] as const
export type State = (typeof STATES)[number]

export function isState(value: string): value is State {
  return (STATES as readonly string[]).includes(value)
}

const RANK: Record<State, number> = {
  todo: 0,
  doing: 1,
  review: 2,
  ready: 3,
  merged: 4,
  blocked: -1,
}

// Send-backs must explain themselves: any backward move (e.g. review → todo) or
// a move to `blocked` requires a note so the next actor knows why.
export function requiresNote(from: State, to: State): boolean {
  if (from === to || from === 'blocked') return false
  if (to === 'blocked') return true
  return RANK[to] < RANK[from]
}

export interface TaskEvent {
  at: string
  actor?: string
  actorKind?: 'human' | 'agent'
  sessionId?: string
  from?: State
  to?: State
  note?: string
  kind?: 'comment' | 'escalate' | 'resolve' // note-only events; absent for transitions
}

// A link to this task's counterpart on a remote system (e.g. a GitHub PR).
export interface TaskLink {
  system: string // e.g. 'github'
  kind: string // e.g. 'pr'
  ref: string // e.g. 'owner/repo#123'
  url?: string
  lastStatus?: string // last summary seen by `relay sync`, to detect changes
}

// Evidence that a gate was cleared. "No evidence == the QA did not happen."
export interface GateEvidence {
  at: string
  by?: string
  evidence?: string // link/path to the proof (screenshot, captured output, log)
}

// Agent-level QA gates, distinct from the human checkpoints (humanReviewed/humanTested).
export type GateKey = 'qa-code-reviewed' | 'qa-manual-tested'

export interface Task {
  id: string
  title: string
  description?: string // what is being done
  plan?: string // approach / steps
  state: State
  project: string // main repo name, stable across worktrees
  branch?: string // git branch the work happens on
  worktree?: string // worktree dir the work happens in
  needsHuman?: boolean // escalated: waiting on a human, orthogonal to state
  // Independent human checkpoints: a task can be tested and still back in review.
  // They accumulate until a human clears them; a reviewed task needs humanTested for done.
  humanReviewed?: boolean
  humanTested?: boolean
  labels?: string[] // free-form tags, orthogonal to state (e.g. awaiting-code-review)
  links?: TaskLink[] // remote counterparts (PRs, tickets) a connector can poll
  skills?: string[] // playbook skills the drainer loads before implementing (cf. OMO load_skills)
  gates?: Record<string, GateEvidence> // evidence gates cleared on this task (key → proof)
  assignee?: string
  watcher?: string // orchestrator agent for the task's lifecycle; persists across send-backs
  createdBy?: string
  createdAt: string
  updatedAt: string // drives `--since` filtering
  history: TaskEvent[]
}

export interface TaskChanges {
  state?: State
  // Guarded transition: fail if the current task state differs from this value.
  // Agents use it to catch a send-back that arrived before their push-to-review.
  expectedState?: State
  assignee?: string
  title?: string
  description?: string
  plan?: string
  branch?: string
  worktree?: string
  labels?: string[] // replace the whole set
  addLabels?: string[] // add without clobbering
  removeLabels?: string[] // remove without clobbering
  addLink?: TaskLink // add a link, replacing any with the same system+ref
  humanReviewed?: boolean // true to set, false to clear
  humanTested?: boolean // true to set, false to clear
  watcher?: string | null // set to a name to register; null to clear
  skills?: string[] // replace the playbook set
  setGate?: { key: string; evidence?: string; by?: string } // record an evidence gate with proof
}

// Per-project policy. Absent fields = today's behavior, so existing projects are unchanged.
export interface ProjectConfig {
  project: string
  requirePlaybook?: boolean // reject claim if the task carries no skill (own or default)
  defaultSkills?: string[] // tasks in this project inherit these when none are set
  readyGates?: GateKey[] // evidence required to move review → ready
  retryCap?: number // auto-bounces on the same cause before escalating to a human
}
