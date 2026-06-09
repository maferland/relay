import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, Button, Icon, StateBadge } from './components/ui.tsx'
import * as api from './lib/api.ts'
import { STATE_META } from './lib/transitions.ts'
import type { Actor, Snapshot, Transition, UiTask } from './lib/types.ts'
import { Board } from './screens/board.tsx'
import { Detail } from './screens/detail.tsx'
import { Inbox } from './screens/inbox.tsx'

type View = 'inbox' | 'board' | 'detail'
interface Toast {
  id: string
  kind: string
  icon: string
  title: string
  desc: string
  taskId?: string
}

function NoteModal({
  task,
  transition,
  onCancel,
  onConfirm,
}: {
  task: UiTask
  transition: Transition
  onCancel: () => void
  onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const required = !!transition.requiresNote
  const ok = !required || note.trim().length >= 4
  const isReject = transition.from === 'review' && transition.to === 'todo'
  const isBlock = transition.to === 'blocked'

  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="m-kicker">
            <Icon name={transition.icon} size={14} />
            {isReject ? 'Send back' : isBlock ? 'Block task' : 'Transition'}
          </div>
          <h3>{transition.label}</h3>
          <p>{task.title}</p>
        </div>
        <div className="modal-body">
          <div className="trans-preview">
            <StateBadge state={transition.from || task.state} size="sm" />
            <Icon
              name="arrowRight"
              size={13}
              style={{ color: 'var(--text-faint)' }}
            />
            <StateBadge
              state={transition.to}
              size="sm"
              solid={transition.to === 'blocked'}
            />
          </div>
          <div className="field-label">
            {required ? 'Required note' : 'Note (optional)'}
            {required && <span className="req">*</span>}
          </div>
          <textarea
            ref={ref}
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              isReject
                ? "What needs to change? Be specific — this is the worker's only context…"
                : isBlock
                  ? 'Why is this blocked? What decision do you need to move forward?'
                  : 'Add context for the audit trail…'
            }
          />
          <div className={`note-hint ${required && !ok ? 'warn' : ''}`}>
            <Icon name={required && !ok ? 'alert' : 'check'} size={12} />
            {required
              ? ok
                ? 'This note is recorded in the task history.'
                : 'A note is required when sending work backward or blocking.'
              : 'Notes become part of the permanent audit trail.'}
          </div>
        </div>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={isReject || isBlock ? 'danger' : 'primary'}
            disabled={!ok}
            onClick={() => onConfirm(note.trim())}
            icon={transition.icon}
          >
            {transition.label}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ToastHost({
  toasts,
  onOpen,
  onDismiss,
}: {
  toasts: Toast[]
  onOpen: (id: string) => void
  onDismiss: (id: string) => void
}) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="t-ic">
            <Icon name={t.icon} size={15} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="t-title">{t.title}</div>
            <div className="t-desc">{t.desc}</div>
            {t.taskId && (
              <div
                className="t-link"
                style={{ fontSize: 'var(--fs-xs)', marginTop: 5 }}
                onClick={() => {
                  onOpen(t.taskId!)
                  onDismiss(t.id)
                }}
              >
                View task →
              </div>
            )}
          </div>
          <span
            className="iconbtn"
            style={{ width: 22, height: 22 }}
            onClick={() => onDismiss(t.id)}
          >
            <Icon name="x" size={13} />
          </span>
        </div>
      ))}
    </div>
  )
}

const EMPTY: Snapshot = { me: 'you', actors: {}, projects: [], tasks: [] }

export function App() {
  const [dark, setDark] = useState(
    () => localStorage.getItem('at-theme') !== 'light'
  )
  const [snap, setSnap] = useState<Snapshot>(EMPTY)
  const [view, setView] = useState<View>('inbox')
  const [openId, setOpenId] = useState<string | null>(null)
  const [modal, setModal] = useState<{
    task: UiTask
    transition: Transition
  } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [lastSync, setLastSync] = useState(Date.now())
  const [syncing, setSyncing] = useState(false)

  const { tasks, actors, me, projects } = snap

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('at-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    const z = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(z)
  }, [])

  const lastSyncRef = useRef(lastSync)
  useEffect(() => {
    lastSyncRef.current = lastSync
  }, [lastSync])

  const refresh = useCallback(async () => {
    const s = await api.fetchSnapshot()
    setSnap(s)
    setLastSync(Date.now())
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh().catch(() => setLoading(false))
  }, [refresh])

  // Long-poll the change feed: refresh when the store reports activity since last sync.
  useEffect(() => {
    const ctrl = new AbortController()
    let stop = false
    ;(async () => {
      while (!stop) {
        try {
          const res = await api.pollChanges(lastSyncRef.current, ctrl.signal)
          if (stop) break
          if (res.tasks.length) {
            setSyncing(true) // flash only while actually applying a change
            await refresh()
            setSyncing(false)
          } else {
            setLastSync(Date.now()) // heartbeat: keep "synced Ns ago" honest
          }
        } catch {
          if (stop) break
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
    })()
    return () => {
      stop = true
      ctrl.abort()
    }
  }, [refresh])

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { ...toast, id }])
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 6500)
  }, [])
  const dismissToast = (id: string) =>
    setToasts((prev) => prev.filter((x) => x.id !== id))

  function openTask(id: string) {
    setOpenId(id)
    setView('detail')
    document.querySelector('.scroll')?.scrollTo(0, 0)
  }
  function goView(v: View) {
    setView(v)
    setOpenId(null)
  }

  function patchTask(updated: UiTask) {
    setSnap((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === updated.id ? updated : t)),
    }))
  }

  function onAction(task: UiTask, transition: Transition) {
    if (transition.requiresNote) {
      setModal({ task, transition: { ...transition, from: task.state } })
      return
    }
    applyTransition(task, transition, '')
  }

  async function applyTransition(
    task: UiTask,
    transition: Transition,
    note: string
  ) {
    setModal(null)
    try {
      const updated = await api.transition(task.id, transition.to, note)
      patchTask(updated)
      const verb =
        transition.to === 'done'
          ? 'passed QA'
          : transition.to === 'blocked'
            ? 'blocked'
            : task.state === 'review' && transition.to === 'todo'
              ? 'sent back'
              : 'moved to ' + STATE_META[transition.to].label.toLowerCase()
      pushToast({
        kind:
          transition.to === 'done'
            ? 'success'
            : transition.to === 'blocked'
              ? 'block'
              : 'update',
        icon:
          transition.to === 'done'
            ? 'check'
            : transition.to === 'blocked'
              ? 'alert'
              : 'arrowRight',
        title: 'You ' + verb,
        desc: task.title,
        taskId: task.id,
      })
    } catch (e) {
      pushToast({
        kind: 'block',
        icon: 'alert',
        title: "Couldn't update",
        desc: e instanceof Error ? e.message : String(e),
      })
      refresh().catch(() => {})
    }
  }

  async function onResolve(task: UiTask) {
    try {
      patchTask(await api.resolve(task.id, ''))
      pushToast({
        kind: 'success',
        icon: 'check',
        title: 'Resolved',
        desc: task.title,
        taskId: task.id,
      })
    } catch (e) {
      pushToast({
        kind: 'block',
        icon: 'alert',
        title: "Couldn't resolve",
        desc: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const isNeedsYou = (t: UiTask) =>
    t.needsHuman ||
    t.state === 'blocked' ||
    (t.state === 'review' && t.assignee === me) ||
    (t.assignee === me && !['blocked', 'review', 'done'].includes(t.state))
  const needsYouCount = tasks.filter(isNeedsYou).length
  const urgentCount = tasks.filter(
    (t) => t.needsHuman || t.state === 'blocked'
  ).length
  const syncSecs = Math.max(0, Math.round((now - lastSync) / 1000))
  const meActor: Actor = actors[me] || { name: me, kind: 'human', short: 'ME' }

  return (
    <div className="app">
      <aside className="side">
        <div className="side-head">
          <div className="brand-mark">at</div>
          <div>
            <div className="brand-name">relay</div>
            <div className="brand-sub">local · sqlite</div>
          </div>
        </div>
        <nav className="nav">
          <button
            className={`nav-item ${view === 'inbox' ? 'is-active' : ''}`}
            onClick={() => goView('inbox')}
          >
            <Icon name="inbox" size={17} /> Needs you
            {needsYouCount > 0 && (
              <span className={`nav-count ${urgentCount ? 'urgent' : ''}`}>
                {needsYouCount}
              </span>
            )}
          </button>
          <button
            className={`nav-item ${view === 'board' || view === 'detail' ? 'is-active' : ''}`}
            onClick={() => goView('board')}
          >
            <Icon name="board" size={17} /> Board
            <span className="nav-count">{tasks.length}</span>
          </button>
        </nav>
        <div className="nav-sec">Repos</div>
        <div className="side-projects">
          {projects.map((p) => {
            const c = tasks.filter((x) => x.project === p).length
            const b = tasks.filter(
              (x) => x.project === p && (x.state === 'blocked' || x.needsHuman)
            ).length
            return (
              <button
                key={p}
                className="nav-item"
                style={{ padding: '6px 10px' }}
                onClick={() => goView('board')}
              >
                <Icon
                  name="folder"
                  size={15}
                  style={{ color: 'var(--text-faint)' }}
                />
                <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                  {p}
                </span>
                {b > 0 ? (
                  <span className="nav-count urgent">{b}</span>
                ) : (
                  <span className="nav-count">{c}</span>
                )}
              </button>
            )
          })}
        </div>
        <div className="side-foot">
          <div className="meta" style={{ gap: 8 }}>
            <Avatar actorId={me} actors={actors} size={26} />
            <div>
              <div
                style={{
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 600,
                  color: 'var(--text)',
                }}
              >
                {meActor.name}
              </div>
              <div
                style={{
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--text-faint)',
                }}
              >
                human · coordinator
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>
            {view === 'inbox'
              ? 'Needs you'
              : view === 'board'
                ? 'Board'
                : 'Task'}
          </h1>
          {view === 'inbox' && (
            <span className="sub">your attention queue</span>
          )}
          {view === 'board' && (
            <span className="sub">all work across {projects.length} repos</span>
          )}
          <div className="spacer" />
          <div
            className={`sync ${syncing ? 'syncing' : ''}`}
            title="local store polling"
          >
            <span className="dot" />
            <Icon name="sync" size={13} />
            {syncing
              ? 'syncing…'
              : `synced ${syncSecs < 5 ? 'just now' : syncSecs + 's ago'}`}
          </div>
          <button
            className="iconbtn bordered"
            title="Toggle theme"
            onClick={() => setDark((d) => !d)}
          >
            <Icon name={dark ? 'sun' : 'moon'} size={16} />
          </button>
        </header>

        <div className="scroll">
          {view === 'inbox' && (
            <Inbox
              tasks={tasks}
              actors={actors}
              me={me}
              now={now}
              loading={loading}
              onOpen={openTask}
              onAction={onAction}
              onResolve={onResolve}
            />
          )}
          {view === 'board' && (
            <Board
              tasks={tasks}
              actors={actors}
              me={me}
              projects={projects}
              now={now}
              onOpen={openTask}
              onAction={onAction}
            />
          )}
          {view === 'detail' && (
            <Detail
              task={tasks.find((t) => t.id === openId)}
              actors={actors}
              me={me}
              now={now}
              onBack={() => goView('board')}
              onAction={onAction}
            />
          )}
        </div>
      </main>

      {modal && (
        <NoteModal
          task={modal.task}
          transition={modal.transition}
          onCancel={() => setModal(null)}
          onConfirm={(note) =>
            applyTransition(modal.task, modal.transition, note)
          }
        />
      )}
      <ToastHost toasts={toasts} onOpen={openTask} onDismiss={dismissToast} />
    </div>
  )
}
