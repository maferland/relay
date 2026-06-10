import {
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  Avatar,
  Button,
  Icon,
  LabelChips,
  MoveMenu,
  ProjectTag,
  StateBadge,
} from '../components/ui.tsx'
import { clockTime, dayLabel, relTime } from '../lib/time.ts'
import { attentionNote, humanActions } from '../lib/transitions.ts'
import type { Actor, State, Transition, UiEvent, UiTask } from '../lib/types.ts'

const NOTE_LABEL: Record<string, string> = {
  comment: 'commented',
  escalate: 'escalated',
  resolve: 'resolved',
}

// PR link refs look like "owner/repo#123".
function repoFromPrRef(ref: string): string | null {
  const m = ref.match(/^(.+)#\d+$/)
  return m ? m[1] : null
}
function prNumber(ref: string): string | null {
  const m = ref.match(/#(\d+)$/)
  return m ? m[1] : null
}

function TransitionPill({
  from,
  to,
  kind,
}: {
  from: State | null
  to: State | null
  kind?: UiEvent['kind']
}) {
  // Note-only event (comment / escalate / resolve): no state change.
  if (!from && !to) {
    return (
      <span className="mini-trans">
        <span
          className="badge-dot"
          style={{ background: 'var(--text-faint)' }}
        />{' '}
        <span style={{ color: 'var(--text-faint)' }}>
          {(kind && NOTE_LABEL[kind]) || 'note'}
        </span>
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
  if (ev.to === 'merged') return 'is-merged'
  if (ev.from === 'review' && ev.to === 'todo') return 'is-reject'
  return ''
}
function eventNoteLabel(ev: UiEvent): string | undefined {
  if (ev.to === 'blocked') return 'Blocked'
  if (ev.from === 'review' && ev.to === 'todo') return 'Sent back'
  return undefined
}
function eventIcon(ev: UiEvent): string {
  if (ev.to === 'blocked') return 'alert'
  if (ev.to === 'merged') return 'check'
  if (ev.from === 'review' && ev.to === 'todo') return 'arrowLeft'
  if (!ev.from && !ev.to) {
    if (ev.kind === 'comment') return 'send'
    if (ev.kind === 'escalate') return 'alert'
    if (ev.kind === 'resolve') return 'check'
    return 'dot'
  }
  if (!ev.from) return 'plus' // creation
  return 'arrowRight'
}

function TimelineNote({ note, label }: { note: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setOverflows(el.scrollHeight - el.clientHeight > 1)
  }, [note])
  return (
    <div className="tl-note">
      {label && <span className="tl-note-tag">{label}</span>}
      <div ref={ref} className={`tl-note-body${expanded ? '' : ' is-clamped'}`}>
        {note}
      </div>
      {(overflows || expanded) && (
        <button
          className="tl-note-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
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
            const kind = eventKind(ev)
            return (
              <div className={`tl-item ${kind}`} key={i}>
                <div className="tl-spine">
                  <div className="tl-node">
                    <Icon name={eventIcon(ev)} size={14} />
                  </div>
                </div>
                <div className="tl-body">
                  <div className="tl-line1">
                    <Avatar actorId={ev.actor} actors={actors} size={18} />
                    <span className="tl-actor">{a.name}</span>
                    <TransitionPill from={ev.from} to={ev.to} kind={ev.kind} />
                    <span className="tl-time">{clockTime(ev.at)}</span>
                  </div>
                  {ev.note && (
                    <TimelineNote note={ev.note} label={eventNoteLabel(ev)} />
                  )}
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

// A checkbox-style bullet that owns its flag: click to toggle. Outstanding (gating) pending
// checks get a calm-amber emphasis; done checks click to clear.
function CheckItem({
  label,
  set,
  stale,
  outstanding,
  onToggle,
}: {
  label: string
  set: boolean
  stale: boolean
  outstanding: boolean
  onToggle: () => void
}) {
  const tone = set
    ? stale
      ? 'stale'
      : 'done'
    : outstanding
      ? 'pending'
      : 'todo'
  return (
    <button
      type="button"
      className={`check-item is-${tone}`}
      onClick={onToggle}
    >
      <Icon
        name={set ? 'checkSquare' : 'square'}
        size={16}
        className="ci-box"
      />
      <span className="ci-name">{label}</span>
      {stale && <span className="ci-suffix">stale</span>}
      {!set && <span className="ci-cta">Mark {label.toLowerCase()}</span>}
    </button>
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
  onResolve: (task: UiTask) => void
  onCheckpoint: (
    task: UiTask,
    flags: { reviewed?: boolean; tested?: boolean }
  ) => void
}

export function Detail({
  task,
  actors,
  me,
  now,
  onBack,
  onAction,
  onComment,
  onResolve,
  onCheckpoint,
}: DetailProps) {
  if (!task) return null
  const actions = humanActions(task.state)
  const note = attentionNote(task)
  const showBanner =
    task.needsHuman ||
    task.state === 'blocked' ||
    (task.state === 'review' && task.assignee === me)
  const mono = { fontSize: 'var(--fs-xs)' } as const
  const prLinks = task.links?.filter((l) => l.kind === 'pr') ?? []
  const otherLinks = task.links?.filter((l) => l.kind !== 'pr') ?? []
  const branchRepo = prLinks.map((l) => repoFromPrRef(l.ref)).find(Boolean)
  const branchUrl =
    task.branch && branchRepo
      ? `https://github.com/${branchRepo}/tree/${task.branch}`
      : undefined
  // Mirror the store's merge guard: a task that went through review can't merge until human-tested.
  const wentThroughReview =
    task.state === 'review' || task.history.some((e) => e.to === 'review')
  const needsTestToMerge = wentThroughReview && !task.humanTested
  // A ready task whose merge is gated on testing: lead with "Mark tested", not a dead merge button.
  const gatedReady = task.state === 'ready' && needsTestToMerge
  const reviewedStale =
    !!task.humanReviewed &&
    task.reviewedAt != null &&
    task.updatedAt > task.reviewedAt
  const testedStale =
    !!task.humanTested &&
    task.testedAt != null &&
    task.updatedAt > task.testedAt
  const showCheckpoints =
    task.state === 'review' ||
    task.state === 'ready' ||
    task.humanReviewed ||
    task.humanTested

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
              {prLinks.map((l) => {
                const num = prNumber(l.ref)
                const label = num ? `PR #${num}` : l.ref
                const text = l.lastStatus ? `${label} · ${l.lastStatus}` : label
                return l.url ? (
                  <a
                    key={l.ref}
                    className="pr-chip"
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="branch" size={13} /> {text}
                  </a>
                ) : (
                  <span key={l.ref} className="pr-chip">
                    <Icon name="branch" size={13} /> {text}
                  </span>
                )
              })}
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
              {task.needsHuman && (
                <Button
                  variant="accent"
                  size="md"
                  icon="check"
                  onClick={() => onResolve(task)}
                >
                  Resolve (hand back to agents)
                </Button>
              )}
              {showCheckpoints && (
                <div className="checklist">
                  <span className="ck-label">Checks</span>
                  <CheckItem
                    label="Reviewed"
                    set={!!task.humanReviewed}
                    stale={reviewedStale}
                    outstanding={false}
                    onToggle={() =>
                      onCheckpoint(task, { reviewed: !task.humanReviewed })
                    }
                  />
                  <CheckItem
                    label="Tested"
                    set={!!task.humanTested}
                    stale={testedStale}
                    outstanding={gatedReady}
                    onToggle={() =>
                      onCheckpoint(task, { tested: !task.humanTested })
                    }
                  />
                </div>
              )}
              {actions.map((t, i) => {
                const blockMerge = t.to === 'merged' && gatedReady
                return (
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
                    disabled={blockMerge}
                    onClick={() => onAction(task, t)}
                  >
                    {t.label}
                  </Button>
                )
              })}
            </div>
            <div className="dmeta">
              <MetaRow icon="folder" k="repo">
                <span className="mono" style={mono}>
                  {task.project}
                </span>
              </MetaRow>
              {task.labels?.length ? (
                <MetaRow icon="tag" k="labels">
                  <span className="card-labels">
                    <LabelChips labels={task.labels} />
                  </span>
                </MetaRow>
              ) : null}
              {otherLinks.length ? (
                <MetaRow icon="branch" k="links">
                  <span className="card-labels">
                    {otherLinks.map((l) => {
                      const text = l.lastStatus
                        ? `${l.ref} · ${l.lastStatus}`
                        : l.ref
                      return l.url ? (
                        <a
                          key={l.ref}
                          className="label-chip"
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {text}
                        </a>
                      ) : (
                        <span key={l.ref} className="label-chip">
                          {text}
                        </span>
                      )
                    })}
                  </span>
                </MetaRow>
              ) : null}
              {task.branch ? (
                <MetaRow icon="branch" k="branch">
                  {branchUrl ? (
                    <a
                      className="mono branch-link"
                      style={mono}
                      href={branchUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {task.branch}
                    </a>
                  ) : (
                    <span className="mono" style={mono}>
                      {task.branch}
                    </span>
                  )}
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
