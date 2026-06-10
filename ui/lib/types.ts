export type State = 'todo' | 'doing' | 'review' | 'done' | 'blocked'

export interface UiEvent {
  at: number // epoch ms
  actor: string
  from: State | null
  to: State | null
  note: string
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
