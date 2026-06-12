import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { AgentRegistry } from './agents.js'

describe('AgentRegistry', () => {
  let dir: string
  let registry: AgentRegistry

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-agents-'))
    registry = new AgentRegistry(dir)
  })

  afterEach(() => {
    registry.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('registers an agent and returns the record', () => {
    const agent = registry.register('relay')
    expect(agent.name).toMatch(/^agent-relay-[0-9a-f]{4}$/)
    expect(agent.project).toBe('relay')
    expect(agent.registeredAt).toBeTruthy()
    expect(agent.lastSeen).toBeTruthy()
  })

  it('lists registered agents', () => {
    registry.register('relay')
    registry.register('relay')
    const agents = registry.list('relay')
    expect(agents.length).toBe(2)
  })

  it('renew updates last_seen', async () => {
    const agent = registry.register('relay')
    const before = agent.lastSeen
    await new Promise((r) => setTimeout(r, 50))
    registry.renew(agent.name)
    const after = registry.get(agent.name)!.lastSeen
    expect(after > before).toBe(true)
  })

  it('status returns active for a fresh agent', () => {
    const agent = registry.register('relay')
    expect(AgentRegistry.status(agent)).toBe('active')
  })

  it('status returns stale when last_seen is past TTL', () => {
    const old = new Date(Date.now() - 700 * 1000).toISOString()
    const agent = registry.register('relay')
    const staleRecord = { ...agent, lastSeen: old }
    expect(AgentRegistry.status(staleRecord, 600)).toBe('stale')
  })

  it('status returns gone when last_seen is very old', () => {
    const old = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    const agent = registry.register('relay')
    const goneRecord = { ...agent, lastSeen: old }
    expect(AgentRegistry.status(goneRecord)).toBe('gone')
  })

  it('list without project returns all agents', () => {
    registry.register('relay')
    registry.register('other')
    expect(registry.list().length).toBe(2)
  })
})
