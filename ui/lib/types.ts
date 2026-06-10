export type State = 'todo' | 'doing' | 'review' | 'ready' | 'merged' | 'blocked'

export interface UiEvent {
  at: number // epoch ms
  actor: string
  from: State | null
  to: State | null
  note: string
  kind: 'comment' | 'escalate' | 'resolve' | null
}

export interface UiTask {
  id: string
  title: string
  description?: string
  plan?: string
  state: State
  project: string
  branch?: string
  worktree?: string
  needsHuman?: boolean
  humanReviewed?: boolean
  humanTested?: boolean
  // When each checkpoint was last set (epoch ms); lets the UI flag a checkpoint as
  // stale once the task sees activity after it was marked.
  reviewedAt?: number
  testedAt?: number
  labels?: string[]
  links?: {
    system: string
    kind: string
    ref: string
    url?: string
    lastStatus?: string
  }[]
  assignee?: string
  createdBy?: string
  createdAt: number
  updatedAt: number
  history: UiEvent[]
}

export interface Actor {
  name: string
  kind: 'human' | 'agent'
  short: string
}

export interface Snapshot {
  me: string
  actors: Record<string, Actor>
  projects: string[]
  tasks: UiTask[]
}

export interface Transition {
  to: State
  from?: State
  label: string
  icon: string
  requiresNote?: boolean
  primary?: boolean
  danger?: boolean
  good?: boolean
}
