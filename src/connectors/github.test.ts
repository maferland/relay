import { describe, expect, it } from 'bun:test'
import { mapPrStatus } from './github.js'

describe('mapPrStatus', () => {
  it('summarizes an open PR with changes requested and failing checks', () => {
    const s = mapPrStatus({
      state: 'OPEN',
      reviewDecision: 'CHANGES_REQUESTED',
      mergedAt: null,
      statusCheckRollup: [{ conclusion: 'FAILURE' }, { conclusion: 'SUCCESS' }],
    })
    expect(s.merged).toBe(false)
    expect(s.checks).toBe('fail')
    expect(s.reviewDecision).toBe('CHANGES_REQUESTED')
    expect(s.summary).toBe('OPEN CHANGES_REQUESTED checks:fail')
  })

  it('marks a merged PR', () => {
    const s = mapPrStatus({ state: 'MERGED', mergedAt: '2026-06-09T00:00:00Z' })
    expect(s.merged).toBe(true)
    expect(s.summary).toBe('MERGED')
  })

  it('treats in-progress checks as pending', () => {
    const s = mapPrStatus({
      state: 'OPEN',
      reviewDecision: 'APPROVED',
      statusCheckRollup: [{ state: 'PENDING' }, { conclusion: 'SUCCESS' }],
    })
    expect(s.checks).toBe('pending')
    expect(s.summary).toBe('OPEN APPROVED checks:pending')
  })

  it('passes when all checks succeed', () => {
    const s = mapPrStatus({
      state: 'OPEN',
      statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    })
    expect(s.checks).toBe('pass')
  })
})
