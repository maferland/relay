import { Fragment, type ReactNode, useState } from 'react'
import {
  Avatar,
  Button,
  Icon,
  MoveMenu,
  ProjectTag,
  StateBadge,
} from '../components/ui.tsx'
import { clockTime, dayLabel, relTime } from '../lib/time.ts'
import { lastNote, transitionsFor } from '../lib/transitions.ts'
import type { Actor, State, Transition, UiEvent, UiTask } from '../lib/types.ts'

function TransitionPill({
  from,
  to,
}: {
  from: State | null
  to: State | null
}) {
  // Note-only event (escalate / resolve / reassign): no state change.
  if (!from && !to) {
    return (
      <span className="mini-trans">
        <span
          className="badge-dot"
          style={{ background: 'var(--text-faint)' }}
        />{' '}
        <span style={{ color: 'var(--text-faint)' }}>note</span>
      </span>
    )
  }
  if (!from && to) {
    return (
      <span className="mini-trans">
        <span
          className="badge-dot"
          style={{ background: 'var(--text-faint)' }}
        />{' '}
        created → <StateBadge state={to} size="sm" />
      </span>
    )
  }
  if (from === to || !to) {
    return (
      <span className="mini-trans">
        <StateBadge state={from!} size="sm" />{' '}
        <span style={{ color: 'var(--text-faint)' }}>note</span>
      </span>
    )
  }
  return (
    <span className="tl-transition">
      <StateBadge state={from!} size="sm" />
      <Icon
        name="arrowRight"
        size={12}
        style={{ color: 'var(--text-faint)' }}
      />
      <StateBadge state={to} size="sm" />
    </span>
  )
}

function eventKind(ev: UiEvent): string {
  if (ev.to === 'blocked') return 'is-block'
  if (ev.to === 'done') return 'is-done'
  if (ev.from === 'review' && ev.to === 'todo') return 'is-reject'
  return ''
}
function eventIcon(ev: UiEvent): string {
  if (ev.to === 'blocked') return 'alert'
  if (ev.to === 'done') return 'check'
  if (ev.from === 'review' && ev.to === 'todo') return 'arrowLeft'
  if (!ev.from && !ev.to) return 'dot' // note-only (escalate/resolve)
  if (!ev.from) return 'plus' // creation
  return 'arrowRight'
}

function Timeline({
  history,
  actors,
  now,
}: {
  history: UiEvent[]
  actors: Record<string, Actor>
  now: number
}) {
  const days: { lbl: string; evs: UiEvent[] }[] = []
  let cur: { lbl: string; evs: UiEvent[] } | null = null
  for (const ev of history) {
    const lbl = dayLabel(ev.at, now)
    if (!cur || cur.lbl !== lbl) {
      cur = { lbl, evs: [] }
      days.push(cur)
    }
    cur.evs.push(ev)
  }
  return (
    <div className="timeline">
      {days.map((d, di) => (
        <Fragment key={di}>
          <div className="tl-day">
            <span className="lbl">{d.lbl}</span>
            <span className="line" />
          </div>
          {d.evs.map((ev, i) => {
            const a = actors[ev.actor] || {
              name: ev.actor,
              kind: 'agent' as const,
            }
            return (
              <div className={`tl-item ${eventKind(ev)}`} key={i}>
                <div className="tl-spine">
                  <div className="tl-node">
                    <Icon name={eventIcon(ev)} size={14} />
                  </div>
                </div>
                <div className="tl-body">
                  <div className="tl-line1">
                    <Avatar actorId={ev.actor} actors={actors} size={18} />
                    <span className="tl-actor">
                      {a.name}
                      {a.kind === 'human' ? ' (you)' : ''}
                    </span>
                    <TransitionPill from={ev.from} to={ev.to} />
                    <span className="tl-time">{clockTime(ev.at)}</span>
                  </div>
                  {ev.note && <div className="tl-note">{ev.note}</div>}
                </div>
              </div>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}

function CommentComposer({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [text, setText] = useState('')
  const send = () => {
    const note = text.trim()
    if (!note) return
    onSubmit(note)
    setText('')
  }
  return (
    <div className="comment-composer">
      <textarea
        value={text}
        placeholder="Leave a note for the next agent…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send()
        }}
      />
      <Button
        variant="primary"
        icon="send"
        disabled={!text.trim()}
        onClick={send}
      >
        Comment
      </Button>
    </div>
  )
}

function MetaRow({
  icon,
  k,
  children,
}: {
  icon: string
  k: string
  children: ReactNode
}) {
  return (
    <div className="dmeta-row">
      <span className="k">
        <Icon name={icon} size={13} /> {k}
      </span>
      <span className="val">{children}</span>
    </div>
  )
}

interface DetailProps {
  task: UiTask | undefined
  actors: Record<string, Actor>
  me: string
  now: number
  onBack: () => void
  onAction: (task: UiTask, t: Transition) => void
  onComment: (task: UiTask, note: string) => void
}

export function Detail({
  task,
  actors,
  me,
  now,
  onBack,
  onAction,
  onComment,
}: DetailProps) {
  if (!task) return null
  const trans = transitionsFor(task.state)
  const note = lastNote(task)
  const showBanner =
    task.needsHuman ||
    task.state === 'blocked' ||
    (task.state === 'review' && task.assignee === me)
  const mono = { fontSize: 'var(--fs-xs)' } as const

  return (
    <div className="page page-wide">
      <button className="detail-back" onClick={onBack}>
        <Icon name="chevLeft" size={15} /> Back
      </button>

      {showBanner && note && (
        <div
          className={`dbanner ${task.state === 'review' && !task.needsHuman ? 'review' : ''}`}
        >
          <span className="db-ic">
            <Icon
              name={
                task.state === 'review' && !task.needsHuman ? 'send' : 'alert'
              }
              size={18}
            />
          </span>
          <div>
            <h5>
              {task.needsHuman
                ? 'Escalated — an agent needs a decision from you'
                : task.state === 'blocked'
                  ? 'This task is blocked and needs your decision'
                  : 'Assigned to you for review'}
            </h5>
            <p>{note.note}</p>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div>
          <div className="detail-head">
            <span className="d-id mono">{task.id}</span>
            <h2>{task.title}</h2>
            <div className="d-badges">
              <MoveMenu task={task} onAction={onAction} />
              <ProjectTag project={task.project} />
              <span className="meta">
                <Icon name="clock" size={13} /> updated{' '}
                {relTime(task.updatedAt, now)}
              </span>
            </div>
          </div>

          {task.description && (
            <div className="dsection">
              <h4>Description</h4>
              <div className="prose">{task.description}</div>
            </div>
          )}

          {task.plan && (
            <div className="dsection">
              <h4>Plan</h4>
              <div className="plan-box mono">{task.plan}</div>
            </div>
          )}

          <div className="dsection">
            <h4>History · worker ↔ QA</h4>
            <Timeline history={task.history} actors={actors} now={now} />
            <CommentComposer onSubmit={(note) => onComment(task, note)} />
          </div>
        </div>

        <aside>
          <div className="drail">
            <div className="drail-actions">
              {trans.map((t, i) => (
                <Button
                  key={t.to + String(i)}
                  variant={
                    t.primary
                      ? t.good
                        ? 'accent'
                        : 'primary'
                      : t.danger
                        ? 'dangerout'
                        : 'default'
                  }
                  size="md"
                  icon={t.icon}
                  onClick={() => onAction(task, t)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            <div className="dmeta">
              <MetaRow icon="folder" k="repo">
                <span className="mono" style={mono}>
                  {task.project}
                </span>
              </MetaRow>
              {task.branch ? (
                <MetaRow icon="branch" k="branch">
                  <span className="mono" style={mono}>
                    {task.branch}
                  </span>
                </MetaRow>
              ) : (
                <MetaRow icon="branch" k="branch">
                  <span style={{ color: 'var(--text-faint)' }}>
                    not claimed yet
                  </span>
                </MetaRow>
              )}
              {task.worktree && (
                <MetaRow icon="worktree" k="worktree">
                  <span className="mono" style={mono}>
                    {task.worktree}
                  </span>
                </MetaRow>
              )}
              <MetaRow icon="user" k="assignee">
                {task.assignee ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                    }}
                  >
                    <Avatar actorId={task.assignee} actors={actors} size={18} />{' '}
                    {actors[task.assignee]?.name || task.assignee}
                    {task.assignee === me ? ' (you)' : ''}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-faint)' }}>unassigned</span>
                )}
              </MetaRow>
              {task.createdBy && (
                <MetaRow icon="bot" k="created by">
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                    }}
                  >
                    <Avatar
                      actorId={task.createdBy}
                      actors={actors}
                      size={18}
                    />{' '}
                    {actors[task.createdBy]?.name || task.createdBy}
                  </span>
                </MetaRow>
              )}
              <MetaRow icon="clock" k="created">
                {dayLabel(task.createdAt, now)}
              </MetaRow>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
