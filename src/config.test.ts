import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { operatorName, readConfig, writeConfig } from './config.js'
import { resolveActor } from './util.js'

describe('operator config', () => {
  let dir: string
  const saved = { ...process.env }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-'))
    process.env.XDG_CONFIG_HOME = dir
    delete process.env.RELAY_ACTOR
    process.env.USER = 'login-user'
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    process.env = { ...saved }
  })

  it('round-trips name through write/read', () => {
    expect(readConfig()).toEqual({})
    writeConfig({ name: 'Marc' })
    expect(readConfig().name).toBe('Marc')
    expect(operatorName()).toBe('Marc')
  })

  it('returns {} for a missing or unreadable config', () => {
    expect(readConfig()).toEqual({})
    expect(operatorName()).toBeUndefined()
  })

  describe('resolveActor precedence', () => {
    it('uses the operator name over the $USER login', () => {
      writeConfig({ name: 'Marc' })
      expect(resolveActor()).toBe('Marc')
    })

    it('falls back to $USER when no name is set', () => {
      expect(resolveActor()).toBe('login-user')
    })

    it('lets RELAY_ACTOR (agents) win over the operator name', () => {
      writeConfig({ name: 'Marc' })
      process.env.RELAY_ACTOR = 'agent-1'
      expect(resolveActor()).toBe('agent-1')
    })

    it('lets an explicit flag win over everything', () => {
      writeConfig({ name: 'Marc' })
      process.env.RELAY_ACTOR = 'agent-1'
      expect(resolveActor('flagged')).toBe('flagged')
    })
  })
})
