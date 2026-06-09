import { Fragment } from 'react'
import {
  Avatar,
  Button,
  Icon,
  ProjectTag,
  StateBadge,
} from '../components/ui.tsx'
import { relTime } from '../lib/time.ts'
import { attentionNote, transitionsFor } from '../lib/transitions.ts'
import type { Actor, Transition, UiTask } from '../lib/types.ts'

type InboxKind = 'escalated' | 'blocked' | 'review' | 'mine'

interface CardProps {
  task: UiTask
  kind: InboxKind
  actors: Record<string, Actor>
  now: number
  onOpen: (id: string) => void
  onAction: (task: UiTask, t: Transition) => void
  onResolve: (task: UiTask) => void
}

function InboxCard({
  task,
  kind,
  actors,
  now,
  onOpen,
  onAction,
  onResolve,
}: CardProps) {
  const trans = transitionsFor(task.state)
  const primary = trans.find((t) => t.primary) || trans[0]
  const secondary =
    trans.find((t) => t !== primary && (t.danger || t.good)) || trans[1]
  const note = attentionNote(task)
  const showReason =
    kind === 'blocked' || kind === 'review' || kind === 'escalated'
  const accentReview = kind === 'review'

  return (
    <div className={`icard is-${kind}`} onClick={() => onOpen(task.id)}>
      <div className="icard-rail" />
      <div className="icard-body">
        <div className="icard-top">
          <StateBadge state={task.state} />
          <span className="icard-id mono">{task.id}</span>
          <ProjectTag
            project={task.project}
            onClick={(e) => {
              e.stopPropagation()
              onOpen(task.id)
            }}
          />
        </div>
        <p className="icard-title">{task.title}</p>

        {note && showReason && (
          <div className={`reason ${accentReview ? 'review' : ''}`}>
            <span className="reason-ic">
              <Icon name={accentReview ? 'send' : 'alert'} size={15} />
            </span>
            <div style={{ minWidth: 0 }}>
              <span className="reason-label">
                {kind === 'escalated'
                  ? 'Needs you: '
                  : kind === 'blocked'
                    ? 'Blocked: '
                    : 'Handed to you: '}
              </span>
              <span>{note.note}</span>
              <div className="reason-author">
                — {actors[note.actor]?.name || note.actor},{' '}
                {relTime(note.at, now)}
              </div>
            </div>
          </div>
        )}

        <div className="icard-foot">
          <span className="waiting">
            <Avatar
              actorId={task.assignee || task.createdBy}
              actors={actors}
              size={20}
            />
            {kind === 'mine' ? (
              <span>
                Assigned to <strong>you</strong>
              </span>
            ) : (
              <span>
                Waiting on <strong>you</strong> ·{' '}
                {actors[note?.actor || task.createdBy || '']?.name ||
                  'an agent'}{' '}
                handed off
              </span>
            )}
          </span>
          <span className="dotsep" />
          <span className="meta">
            <Icon name="clock" size={12} /> updated{' '}
            {relTime(task.updatedAt, now)}
          </span>
        </div>
      </div>

      <div className="icard-actions" onClick={(e) => e.stopPropagation()}>
        {kind === 'escalated' ? (
          <Fragment>
            <Button
              variant="accent"
              size="md"
              icon="check"
              onClick={() => onResolve(task)}
            >
              Resolve
            </Button>
            {primary && (
              <Button
                variant="default"
                size="md"
                icon={primary.icon}
                onClick={() => onAction(task, primary)}
              >
                {primary.label}
              </Button>
            )}
          </Fragment>
        ) : (
          <Fragment>
            {primary && (
              <Button
                variant={
                  primary.good
                    ? 'accent'
                    : primary.danger
                      ? 'danger'
                      : 'primary'
                }
                size="md"
                icon={primary.icon}
                onClick={() => onAction(task, primary)}
              >
                {primary.label}
              </Button>
            )}
            {secondary && (
              <Button
                variant={secondary.danger ? 'dangerout' : 'default'}
                size="md"
                icon={secondary.icon}
                onClick={() => onAction(task, secondary)}
              >
                {secondary.label}
              </Button>
            )}
          </Fragment>
        )}
        <Button
          variant="ghost"
          size="sm"
          iconRight="chevRight"
          onClick={() => onOpen(task.id)}
        >
          Open detail
        </Button>
      </div>
    </div>
  )
}

interface GroupProps extends Omit<CardProps, 'task'> {
  groupIcon: string
  title: string
  desc: string
  tasks: UiTask[]
}

function Group({ groupIcon, kind, title, desc, tasks, ...rest }: GroupProps) {
  if (!tasks.length) return null
  return (
    <div className="grp">
      <div className={`grp-head ${kind}`}>
        <span className="gh-icon">
          <Icon name={groupIcon} size={14} />
        </span>
        <h3>{title}</h3>
        <span className="gh-count mono">{tasks.length}</span>
        {desc && <span className="gh-desc">{desc}</span>}
      </div>
      <div className="cards">
        {tasks.map((t) => (
          <InboxCard key={t.id} task={t} kind={kind} {...rest} />
        ))}
      </div>
    </div>
  )
}

interface InboxProps {
  tasks: UiTask[]
  actors: Record<string, Actor>
  me: string
  now: number
  loading: boolean
  onOpen: (id: string) => void
  onAction: (task: UiTask, t: Transition) => void
  onResolve: (task: UiTask) => void
}

export function Inbox({
  tasks,
  actors,
  me,
  now,
  loading,
  onOpen,
  onAction,
  onResolve,
}: InboxProps) {
  const oldestFirst = (a: UiTask, b: UiTask) => a.updatedAt - b.updatedAt
  // Escalated takes precedence so a task never appears in two groups.
  const escalated = tasks.filter((t) => t.needsHuman).sort(oldestFirst)
  const free = tasks.filter((t) => !t.needsHuman)
  const blocked = free.filter((t) => t.state === 'blocked').sort(oldestFirst)
  const review = free
    .filter((t) => t.state === 'review' && t.assignee === me)
    .sort(oldestFirst)
  const mine = free
    .filter(
      (t) =>
        t.assignee === me && !['blocked', 'review', 'done'].includes(t.state)
    )
    .sort(oldestFirst)
  const total = escalated.length + blocked.length + review.length + mine.length

  if (loading) return <InboxSkeleton />

  const shared = { actors, now, onOpen, onAction, onResolve }

  return (
    <div className="page">
      <div className="inbox-head">
        <div className="inbox-title">
          <h2>Needs you</h2>
          {total > 0 && (
            <span className="inbox-count mono">
              {total} item{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="inbox-sub">
          The few things waiting on a decision from you. Everything else is
          moving agent-to-agent on the board.
        </p>
      </div>

      {total === 0 ? (
        <div className="empty allclear">
          <div className="e-ic">
            <Icon name="check" size={26} />
          </div>
          <h3>Nothing needs you right now</h3>
          <p>
            No escalations, no blocked tasks, no reviews assigned to you,
            nothing in your queue. Agents are handling the rest — check the
            board to watch the work flow.
          </p>
        </div>
      ) : (
        <Fragment>
          <Group
            groupIcon="alert"
            kind="escalated"
            title="Escalated — needs you"
            desc="an agent flagged this for a human"
            tasks={escalated}
            {...shared}
          />
          <Group
            groupIcon="alert"
            kind="blocked"
            title="Blocked"
            desc="an agent is stuck and needs your call"
            tasks={blocked}
            {...shared}
          />
          <Group
            groupIcon="send"
            kind="review"
            title="Review — waiting on you"
            desc="QA handoff assigned to you"
            tasks={review}
            {...shared}
          />
          <Group
            groupIcon="user"
            kind="mine"
            title="Assigned to you"
            desc="in your queue"
            tasks={mine}
            {...shared}
          />
        </Fragment>
      )}
    </div>
  )
}

function InboxSkeleton() {
  return (
    <div className="page">
      <div className="inbox-head">
        <div className="inbox-title">
          <div className="skel" style={{ width: 180, height: 30 }} />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="grp">
          <div className="grp-head">
            <div className="skel" style={{ width: 120, height: 16 }} />
          </div>
          <div className="cards">
            {[0, 1].map((j) => (
              <div key={j} className="icard" style={{ cursor: 'default' }}>
                <div className="icard-rail" />
                <div
                  className="icard-body"
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="skel" style={{ width: 90, height: 18 }} />
                  <div className="skel" style={{ width: '70%', height: 16 }} />
                  <div className="skel" style={{ width: '100%', height: 40 }} />
                </div>
                <div className="icard-actions">
                  <div className="skel" style={{ height: 32 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
