import { describe, expect, it } from 'bun:test'
import { shouldNag } from './update-check.js'

describe('shouldNag', () => {
  it('nags when a newer version is cached', () => {
    expect(shouldNag({ current: '0.2.0', latest: '0.3.0' })).toBe(true)
  })

  it('stays quiet when already current or ahead', () => {
    expect(shouldNag({ current: '0.3.0', latest: '0.3.0' })).toBe(false)
    expect(shouldNag({ current: '0.4.0', latest: '0.3.0' })).toBe(false)
  })

  it('stays quiet for dev builds and when nothing is cached', () => {
    expect(shouldNag({ current: 'dev', latest: '9.9.9' })).toBe(false)
    expect(shouldNag({ current: '0.2.0', latest: undefined })).toBe(false)
  })
})
