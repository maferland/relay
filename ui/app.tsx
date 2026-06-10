import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, Button, Icon, StateBadge } from './components/ui.tsx'
import * as api from './lib/api.ts'
import type { BoardFilters } from './lib/router.ts'
import { DEFAULT_FILTERS, useRouter } from './lib/router.ts'
import { STATE_META } from './lib/transitions.ts'
import type { Actor, Snapshot, Transition, UiTask } from './lib/types.ts'
import { Board } from './screens/board.tsx'
import { Detail } from './screens/detail.tsx'
import { Inbox } from './screens/inbox.tsx'

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

function ResolveModal({
  task,
  onCancel,
  onConfirm,
}: {
  task: UiTask
  onCancel: () => void
  onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
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
            <Icon name="check" size={14} /> Hand back to agents
          </div>
          <h3>Resolve escalation</h3>
          <p>{task.title}</p>
        </div>
        <div className="modal-body">
          <div className="field-label">Reply to the agent (optional)</div>
          <textarea
            ref={ref}
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Answer the question or say what you decided — the agent picks the task back up with this note…"
          />
          <div className="note-hint">
            <Icon name="check" size={12} />
            Clears the needs-human flag and records your reply in the history.
          </div>
        </div>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="accent"
            icon="check"
            onClick={() => onConfirm(note.trim())}
          >
            Resolve
          </Button>
        </div>
      </div>
    </div>
  )
}

function CreateModal({
  projects,
  defaultProject,
  onCancel,
  onConfirm,
}: {
  projects: string[]
  defaultProject: string
  onCancel: () => void
  onConfirm: (input: api.NewTaskInput) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [project, setProject] = useState(defaultProject)
  const [assignee, setAssignee] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const ok = title.trim().length > 0 && project.trim().length > 0
  const submit = () => {
    if (!ok) return
    onConfirm({
      title: title.trim(),
      description: description.trim() || undefined,
      project: project.trim(),
      assignee: assignee.trim() || undefined,
    })
  }

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
            <Icon name="plus" size={14} /> New task
          </div>
          <h3>Create a task</h3>
          <p>Log work for an agent to pick up, or track it yourself.</p>
        </div>
        <div className="modal-body create-fields">
          <div>
            <div className="field-label">
              Title<span className="req">*</span>
            </div>
            <input
              ref={ref}
              className="field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
              }}
              placeholder="What needs doing?"
            />
          </div>
          <div>
            <div className="field-label">Description</div>
            <textarea
              className="note-input"
              style={{ minHeight: 64 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Context for whoever picks this up…"
            />
          </div>
          <div className="create-row">
            <div>
              <div className="field-label">
                Repo<span className="req">*</span>
              </div>
              <input
                className="field-input"
                list="create-projects"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="project"
              />
              <datalist id="create-projects">
                {projects.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div>
              <div className="field-label">Assignee</div>
              <input
                className="field-input"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="unassigned"
              />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" icon="plus" disabled={!ok} onClick={submit}>
            Create task
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
  const { route, navigate } = useRouter()
  const view = route.screen
  const openId = route.taskId
  const proj = route.board.proj // the active repo lens, shared by inbox + board
  const [modal, setModal] = useState<{
    task: UiTask
    transition: Transition
  } | null>(null)
  const [resolveTask, setResolveTask] = useState<UiTask | null>(null)
  const [creating, setCreating] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [lastSync, setLastSync] = useState(Date.now())
  const [syncing, setSyncing] = useState(false)

  const { tasks, actors, me, projects } = snap

  // Remember board filters across a detour into a task so the Back button restores them.
  const lastBoardFilters = useRef<BoardFilters>(route.board)
  if (view === 'board') lastBoardFilters.current = route.board

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
    // Carry the repo lens through the detour so Back returns to the same filtered view.
    navigate({
      screen: 'detail',
      taskId: id,
      board: { ...DEFAULT_FILTERS, proj },
    })
    document.querySelector('.scroll')?.scrollTo(0, 0)
  }
  function goInbox() {
    // Keep the repo lens when switching to the inbox; drop the board-only filters.
    navigate({
      screen: 'inbox',
      taskId: null,
      board: { ...DEFAULT_FILTERS, proj },
    })
  }
  function goBoard(board: BoardFilters) {
    navigate({ screen: 'board', taskId: null, board })
  }
  // Sidebar repo click: filter the current screen in place rather than always jumping to the board.
  function selectRepo(next: string | null) {
    if (view === 'inbox') {
      navigate({
        screen: 'inbox',
        taskId: null,
        board: { ...DEFAULT_FILTERS, proj: next },
      })
    } else {
      goBoard({ ...lastBoardFilters.current, proj: next })
    }
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
        transition.to === 'merged'
          ? 'merged'
          : transition.to === 'ready'
            ? 'passed QA'
            : transition.to === 'blocked'
              ? 'blocked'
              : task.state === 'review' && transition.to === 'todo'
                ? 'sent back'
                : 'moved to ' + STATE_META[transition.to].label.toLowerCase()
      pushToast({
        kind:
          transition.to === 'merged' || transition.to === 'ready'
            ? 'success'
            : transition.to === 'blocked'
              ? 'block'
              : 'update',
        icon:
          transition.to === 'merged' || transition.to === 'ready'
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

  function onResolve(task: UiTask) {
    setResolveTask(task)
  }

  async function doResolve(task: UiTask, note: string) {
    setResolveTask(null)
    try {
      patchTask(await api.resolve(task.id, note))
      pushToast({
        kind: 'success',
        icon: 'check',
        title: note ? 'Resolved & replied' : 'Resolved',
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

  async function doCreate(input: api.NewTaskInput) {
    setCreating(false)
    try {
      const created = await api.createTask(input)
      setSnap((s) => ({
        ...s,
        projects: s.projects.includes(created.project)
          ? s.projects
          : [...s.projects, created.project].sort(),
        tasks: [created, ...s.tasks],
      }))
      pushToast({
        kind: 'success',
        icon: 'plus',
        title: 'Task created',
        desc: created.title,
        taskId: created.id,
      })
    } catch (e) {
      pushToast({
        kind: 'block',
        icon: 'alert',
        title: "Couldn't create task",
        desc: e instanceof Error ? e.message : String(e),
      })
    }
  }

  async function onComment(task: UiTask, note: string) {
    try {
      patchTask(await api.comment(task.id, note))
      pushToast({
        kind: 'success',
        icon: 'send',
        title: 'Comment added',
        desc: task.title,
        taskId: task.id,
      })
    } catch (e) {
      pushToast({
        kind: 'block',
        icon: 'alert',
        title: "Couldn't comment",
        desc: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // The repo lens scopes the inbox and the left-nav counts; the board filters itself by route.board.proj.
  const scopedTasks = proj ? tasks.filter((t) => t.project === proj) : tasks
  const isNeedsYou = (t: UiTask) =>
    t.needsHuman ||
    t.state === 'blocked' ||
    (t.state === 'review' && t.assignee === me) ||
    (t.assignee === me &&
      !['blocked', 'review', 'ready', 'merged'].includes(t.state))
  const needsYouCount = scopedTasks.filter(isNeedsYou).length
  const urgentCount = scopedTasks.filter(
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
            onClick={goInbox}
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
            onClick={() => goBoard({ ...lastBoardFilters.current, proj })}
          >
            <Icon name="board" size={17} /> Board
            <span className="nav-count">{scopedTasks.length}</span>
          </button>
        </nav>
        <div className="nav-sec">Repos</div>
        <div className="side-projects">
          <button
            className={`nav-item ${!proj ? 'is-active' : ''}`}
            style={{ padding: '6px 10px' }}
            onClick={() => selectRepo(null)}
          >
            <Icon
              name="folder"
              size={15}
              style={{ color: 'var(--text-faint)' }}
            />
            <span style={{ fontSize: 'var(--fs-xs)' }}>All repos</span>
            <span className="nav-count">{tasks.length}</span>
          </button>
          {projects.map((p) => {
            const c = tasks.filter((x) => x.project === p).length
            const b = tasks.filter(
              (x) => x.project === p && (x.state === 'blocked' || x.needsHuman)
            ).length
            return (
              <button
                key={p}
                className={`nav-item ${proj === p ? 'is-active' : ''}`}
                style={{ padding: '6px 10px' }}
                onClick={() => selectRepo(proj === p ? null : p)}
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
            <span className="sub">
              {proj ? `${proj} · your queue` : 'your attention queue'}
            </span>
          )}
          {view === 'board' && (
            <span className="sub">
              {proj ? proj : `all work across ${projects.length} repos`}
            </span>
          )}
          <div className="spacer" />
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            onClick={() => setCreating(true)}
          >
            New task
          </Button>
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
              tasks={scopedTasks}
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
              filters={route.board}
              onFilters={goBoard}
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
              onBack={() => goBoard({ ...lastBoardFilters.current, proj })}
              onAction={onAction}
              onComment={onComment}
              onResolve={onResolve}
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
      {resolveTask && (
        <ResolveModal
          task={resolveTask}
          onCancel={() => setResolveTask(null)}
          onConfirm={(note) => doResolve(resolveTask, note)}
        />
      )}
      {creating && (
        <CreateModal
          projects={projects}
          defaultProject={proj ?? projects[0] ?? ''}
          onCancel={() => setCreating(false)}
          onConfirm={doCreate}
        />
      )}
      <ToastHost toasts={toasts} onOpen={openTask} onDismiss={dismissToast} />
    </div>
  )
}
