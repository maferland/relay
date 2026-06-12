import { Database } from 'bun:sqlite'
import path from 'path'
import { dataDir } from './util.js'

export interface AgentRecord {
  name: string
  project?: string
  registeredAt: string
  lastSeen: string
}

export type AgentStatus = 'active' | 'stale' | 'gone'

const DEFAULT_TTL = 600 // 10 minutes in seconds
const GONE_AFTER = 3600 // 1 hour

function ageSeconds(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 1000
}

function agentStatus(rec: AgentRecord, ttl: number): AgentStatus {
  const age = ageSeconds(rec.lastSeen)
  if (age <= ttl) return 'active'
  if (age <= GONE_AFTER) return 'stale'
  return 'gone'
}

function generateName(project?: string): string {
  const prefix = project
    ? project
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 6)
    : 'agent'
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 4)
  return `agent-${prefix}-${suffix}`
}

interface Row {
  name: string
  project: string | null
  registered_at: string
  last_seen: string
}

function toRecord(row: Row): AgentRecord {
  return {
    name: row.name,
    project: row.project ?? undefined,
    registeredAt: row.registered_at,
    lastSeen: row.last_seen,
  }
}

export class AgentRegistry {
  private db: Database

  constructor(dir?: string) {
    const base = dir ?? dataDir()
    this.db = new Database(path.join(base, 'tasks.db'))
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        project TEXT,
        registered_at TEXT NOT NULL,
        last_seen TEXT NOT NULL
      )`
    )
  }

  close(): void {
    this.db.close()
  }

  register(project?: string, ttl = DEFAULT_TTL): AgentRecord {
    const name = generateName(project)
    const now = new Date().toISOString()
    const existing = this.db
      .query('SELECT * FROM agents WHERE name = ?')
      .get(name) as Row | null
    if (existing && ageSeconds(existing.last_seen) <= ttl) {
      throw new Error(
        `Agent "${name}" is already active. This is unexpected — re-run to get a new name.`
      )
    }
    this.db
      .query(
        'INSERT OR REPLACE INTO agents (name, project, registered_at, last_seen) VALUES (?, ?, ?, ?)'
      )
      .run(name, project ?? null, now, now)
    return { name, project, registeredAt: now, lastSeen: now }
  }

  renew(name: string): void {
    const now = new Date().toISOString()
    this.db
      .query('UPDATE agents SET last_seen = ? WHERE name = ?')
      .run(now, name)
  }

  get(name: string): AgentRecord | null {
    const row = this.db
      .query('SELECT * FROM agents WHERE name = ?')
      .get(name) as Row | null
    return row ? toRecord(row) : null
  }

  list(project?: string): AgentRecord[] {
    const rows = project
      ? (this.db
          .query(
            'SELECT * FROM agents WHERE project = ? ORDER BY last_seen DESC'
          )
          .all(project) as Row[])
      : (this.db
          .query('SELECT * FROM agents ORDER BY last_seen DESC')
          .all() as Row[])
    return rows.map(toRecord)
  }

  static status(rec: AgentRecord, ttl = DEFAULT_TTL): AgentStatus {
    return agentStatus(rec, ttl)
  }
}
