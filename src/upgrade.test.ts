import { describe, expect, it } from 'bun:test'
import { assetName, isNewer } from './upgrade.js'

describe('assetName', () => {
  it('maps supported platforms to release asset names', () => {
    expect(assetName('darwin', 'arm64')).toBe('relay-darwin-arm64')
    expect(assetName('darwin', 'x64')).toBe('relay-darwin-x64')
    expect(assetName('linux', 'x64')).toBe('relay-linux-x64')
    expect(assetName('linux', 'arm64')).toBe('relay-linux-arm64')
  })

  it('returns null for unsupported platforms or arches', () => {
    expect(assetName('win32', 'x64')).toBeNull()
    expect(assetName('linux', 'ia32')).toBeNull()
  })
})

describe('isNewer', () => {
  it.each([
    ['0.3.0', '0.2.0', true],
    ['v0.3.0', '0.2.9', true],
    ['0.2.1', '0.2.0', true],
    ['1.0.0', '0.9.9', true],
    ['0.2.0', '0.2.0', false],
    ['0.2.0', '0.3.0', false],
    ['0.2.0', 'v0.2.0', false],
  ])('isNewer(%s, %s) === %s', (a, b, expected) => {
    expect(isNewer(a as string, b as string)).toBe(expected)
  })
})
