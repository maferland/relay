import { useEffect, useMemo, useState } from 'react'
import { Avatar, Icon, LabelChips, MoveMenu } from '../components/ui.tsx'
import { relTime } from '../lib/time.ts'
import { STATE_META } from '../lib/transitions.ts'
import type { Actor, State, Transition, UiTask } from '../lib/types.ts'
import { Kanban } from './kanban.tsx'

const SINCE_OPTS = [
  { k: 'any', label: 'Any time', ms: Infinity },
  { k: '1h', label: 'Last hour', ms: 3600e3 },
  { k: '24h', label: 'Last 24h', ms: 24 * 3600e3 },
  { k: '7d', label: 'Last 7 days', ms: 7 * 24 * 3600e3 },
]

const BOARD_STATES: State[] = ['todo', 'doing', 'review', 'done', 'blocked']

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

interface BoardProps {
  tasks: UiTask[]
  actors: Record<string, Actor>
  me: string
  projects: string[]
  now: number
  onOpen: (id: string) => void
  onAction: (task: UiTask, t: Transition) => void
}

export function Board({
  tasks,
  actors,
  me,
  projects,
  now,
  onOpen,
  onAction,
}: BoardProps) {
  const [q, setQ] = useState('')
  const [states, setStates] = useState<Set<State>>(new Set())
  const [proj, setProj] = useState<string | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [since, setSince] = useState('any')
  const [grouped, setGrouped] = useState(true)
  const [bview, setBview] = useState<'list' | 'kanban'>('kanban')
  const [sel, setSel] = useState(-1)

  const sinceMs = SINCE_OPTS.find((s) => s.k === since)!.ms

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return tasks
      .filter((t) => {
        if (states.size && !states.has(t.state)) return false
        if (proj && t.project !== proj) return false
        if (mineOnly && t.assignee !== me) return false
        if (now - t.updatedAt > sinceMs) return false
        if (ql) {
          const hay = (
            t.title +
            ' ' +
            t.id +
            ' ' +
            t.project +
            ' ' +
            (t.assignee || '') +
            ' ' +
            (t.branch || '')
          ).toLowerCase()
          if (!hay.includes(ql)) return false
        }
        return true
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [tasks, q, states, proj, mineOnly, sinceMs, now, me])

  useEffect(() => {
    setSel(-1)
  }, [q, states, proj, mineOnly, since, grouped])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (bview !== 'list') return
      if (e.key === 'j') {
        e.preventDefault()
        setSel((s) => Math.min(filtered.length - 1, s + 1))
      } else if (e.key === 'k') {
        e.preventDefault()
        setSel((s) => Math.max(0, s - 1))
      } else if (
        (e.key === 'e' || e.key === 'Enter') &&
        sel >= 0 &&
        filtered[sel]
      ) {
        e.preventDefault()
        onOpen(filtered[sel].id)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filtered, sel, onOpen, bview])

  const stateCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of tasks) c[t.state] = (c[t.state] || 0) + 1
    return c
  }, [tasks])

  const toggleState = (s: State) =>
    setStates((prev) => {
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })

  const groups = useMemo<[string, UiTask[]][]>(() => {
    if (!grouped) return [['', filtered]]
    const m = new Map<string, UiTask[]>()
    for (const t of filtered) {
      if (!m.has(t.project)) m.set(t.project, [])
      m.get(t.project)!.push(t)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, grouped])

  let runningIndex = -1

  return (
    <div className="page page-wide">
      <div className="board-toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, ids, branches…"
          />
          {q && (
            <span
              className="iconbtn"
              style={{ width: 20, height: 20 }}
              onClick={() => setQ('')}
            >
              <Icon name="x" size={13} />
            </span>
          )}
        </div>
        <div className="segmented">
          {BOARD_STATES.map((s) => (
            <button
              key={s}
              className={`seg ${states.has(s) ? 'is-active' : ''}`}
              onClick={() => toggleState(s)}
            >
              <span
                className="badge-dot"
                style={{ background: `var(--st-${s}-fg)` }}
              />
              {STATE_META[s].label}
              <span className="seg-count">{stateCounts[s] || 0}</span>
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="segmented">
          <button
            className={`seg ${bview === 'list' ? 'is-active' : ''}`}
            onClick={() => setBview('list')}
          >
            <Icon name="list" size={13} /> List
          </button>
          <button
            className={`seg ${bview === 'kanban' ? 'is-active' : ''}`}
            onClick={() => setBview('kanban')}
          >
            <Icon name="board" size={13} /> Board
          </button>
        </div>
        {bview === 'list' && (
          <button
            className={`chip ${grouped ? 'is-active' : ''}`}
            onClick={() => setGrouped((g) => !g)}
          >
            <Icon name="folder" size={13} /> Group by repo
          </button>
        )}
      </div>

      <div className="filterbar">
        <span className="filter-label">repo</span>
        <button
          className={`chip ${!proj ? 'is-active' : ''}`}
          onClick={() => setProj(null)}
        >
          all
        </button>
        {projects.map((p) => (
          <button
            key={p}
            className={`chip ${proj === p ? 'is-active' : ''}`}
            onClick={() => setProj(proj === p ? null : p)}
          >
            <span className="mono">{p}</span>
          </button>
        ))}
        <span style={{ width: 8 }} />
        <button
          className={`chip ${mineOnly ? 'is-active' : ''}`}
          onClick={() => setMineOnly((m) => !m)}
        >
          <Icon name="user" size={13} /> assigned to me
        </button>
        <span style={{ width: 8 }} />
        <span className="filter-label">updated</span>
        {SINCE_OPTS.map((s) => (
          <button
            key={s.k}
            className={`chip ${since === s.k ? 'is-active' : ''}`}
            onClick={() => setSince(s.k)}
          >
            {s.label}
          </button>
        ))}
        <div className="spacer" />
        <span className="meta mono">
          {filtered.length} of {tasks.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="e-ic">
            <Icon name="search" size={24} />
          </div>
          <h3>No tasks match</h3>
          <p>
            Try clearing a filter or widening the time window. {tasks.length}{' '}
            tasks exist across {projects.length} repos.
          </p>
        </div>
      ) : bview === 'kanban' ? (
        <Kanban
          tasks={filtered}
          actors={actors}
          me={me}
          onOpen={onOpen}
          onAction={onAction}
        />
      ) : (
        groups.map(([name, rows]) => (
          <div className="board-group" key={name || 'all'}>
            {name && (
              <div className="board-group-head">
                <Icon
                  name="folder"
                  size={14}
                  style={{ color: 'var(--text-faint)' }}
                />
                <span className="bgh-name">{name}</span>
                <span className="bgh-count">{rows.length}</span>
                <span className="line" />
              </div>
            )}
            <div className="rows">
              {rows.map((t) => {
                runningIndex++
                const idx = runningIndex
                const needsMe =
                  t.needsHuman ||
                  t.state === 'blocked' ||
                  (t.state === 'review' && t.assignee === me)
                return (
                  <div
                    key={t.id}
                    className={`row state-${t.state} ${t.state === 'blocked' ? 'is-blocked' : ''} ${
                      t.state === 'done' ? 'is-done' : ''
                    } ${sel === idx ? 'is-selected' : ''}`}
                    onClick={() => onOpen(t.id)}
                    onMouseEnter={() => setSel(idx)}
                  >
                    <MoveMenu task={t} onAction={onAction} />
                    <div className="row-main">
                      <div className="row-title">{t.title}</div>
                      <div className="row-meta">
                        <span className="row-id mono">{t.id}</span>
                        {!grouped && <span className="dotsep" />}
                        {!grouped && (
                          <span className="meta">
                            <Icon name="folder" size={11} />{' '}
                            <span className="mono">{t.project}</span>
                          </span>
                        )}
                        {t.branch && <span className="dotsep" />}
                        {t.branch && (
                          <span className="meta row-branch">
                            <Icon name="branch" size={11} />{' '}
                            <span className="mono">{t.branch}</span>
                          </span>
                        )}
                        {t.labels?.length ? (
                          <>
                            <span className="dotsep" />
                            <LabelChips labels={t.labels} />
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="row-right">
                      {needsMe && (
                        <span className="row-att" title="needs you" />
                      )}
                      {t.assignee ? (
                        <Avatar
                          actorId={t.assignee}
                          actors={actors}
                          size={20}
                        />
                      ) : (
                        <span
                          className="meta"
                          style={{ fontSize: 'var(--fs-xs)' }}
                        >
                          unassigned
                        </span>
                      )}
                      <span className="row-time mono">
                        {relTime(t.updatedAt, now)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {bview === 'list' ? (
        <div
          style={{
            display: 'flex',
            gap: 14,
            marginTop: 18,
            color: 'var(--text-faint)',
            fontSize: 'var(--fs-xs)',
            alignItems: 'center',
          }}
        >
          <span>Navigate</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
          </span>
          <span>open</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <Kbd>e</Kbd>
          </span>
          <span style={{ marginLeft: 8 }}>
            · click a state badge to move a task
          </span>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 16,
            color: 'var(--text-faint)',
            fontSize: 'var(--fs-xs)',
            alignItems: 'center',
          }}
        >
          <Icon name="list" size={13} /> Drag a card between columns to change
          its state. Moving backward or to Blocked asks for a note.
        </div>
      )}
    </div>
  )
}
