import { execFileSync } from 'child_process'
import type { TaskLink } from '../types.js'
import type { Connector, RemoteStatus } from './types.js'

interface GhPr {
  state?: string
  reviewDecision?: string
  mergedAt?: string | null
  statusCheckRollup?: { state?: string; conclusion?: string }[]
}

// Pure: fold a `gh pr view --json` payload into a RemoteStatus. Tested with fixtures.
export function mapPrStatus(pr: GhPr): RemoteStatus {
  const merged = !!pr.mergedAt
  const rollup = pr.statusCheckRollup ?? []
  let checks: RemoteStatus['checks'] | undefined
  if (rollup.length) {
    const norm = rollup.map((c) =>
      (c.conclusion || c.state || '').toUpperCase()
    )
    if (norm.some((s) => ['FAILURE', 'ERROR', 'CANCELLED'].includes(s)))
      checks = 'fail'
    else if (
      norm.some((s) => ['PENDING', 'IN_PROGRESS', 'QUEUED', ''].includes(s))
    )
      checks = 'pending'
    else checks = 'pass'
  }
  const summary = [
    merged ? 'MERGED' : pr.state,
    pr.reviewDecision,
    checks ? `checks:${checks}` : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  return {
    state: pr.state,
    reviewDecision: pr.reviewDecision,
    checks,
    merged,
    summary,
  }
}

// "owner/repo#123" → { repo: "owner/repo", number: "123" }
function repoAndNumber(ref: string): { repo: string; number: string } | null {
  const m = ref.match(/^(.+)#(\d+)$/)
  return m ? { repo: m[1], number: m[2] } : null
}

export const githubConnector: Connector = {
  system: 'github',
  async poll(link: TaskLink): Promise<RemoteStatus | null> {
    const rn = repoAndNumber(link.ref)
    if (!rn) return null
    try {
      const out = execFileSync(
        'gh',
        [
          'pr',
          'view',
          rn.number,
          '-R',
          rn.repo,
          '--json',
          'state,reviewDecision,mergedAt,statusCheckRollup',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      )
      return mapPrStatus(JSON.parse(out) as GhPr)
    } catch {
      return null
    }
  },
}
