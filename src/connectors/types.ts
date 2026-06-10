import type { TaskLink } from '../types.js'

export interface RemoteStatus {
  state?: string
  reviewDecision?: string
  checks?: 'pass' | 'fail' | 'pending'
  merged?: boolean
  summary: string // stable one-line digest; a change in this drives `relay sync`
}

export interface Connector {
  system: string
  poll(link: TaskLink): Promise<RemoteStatus | null>
}
