import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { Actor, State, Transition, UiTask } from '../lib/types.ts'
import { STATE_META, transitionsFor } from '../lib/transitions.ts'

const PATHS: Record<string, string> = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  filter: 'M3 5h18M6 12h12M10 19h4',
  chevDown: 'M6 9l6 6 6-6',
  chevRight: 'M9 6l6 6-6 6',
  chevLeft: 'M15 6l-6 6 6 6',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  branch:
    'M6 4v12M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 6c0 4-6 3-6 8',
  folder:
    'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  alert:
    'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  inbox:
    'M3 12h5l2 3h4l2-3h5M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  board: 'M4 5h6v14H4zM14 5h6v8h-6z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  sync: 'M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M3 20v-4h4',
  plus: 'M12 5v14M5 12h14',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6',
  bot: 'M9 13h.01M15 13h.01M12 4v3M7 7h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM3 12v3M21 12v3',
  dot: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  worktree:
    'M5 3v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3M12 9v12M8 21h8M5 12l-2 2 2 2',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  tag: 'M3 5.5A2.5 2.5 0 0 1 5.5 3H11l9 9-7.5 7.5L3 10.5V5.5ZM7 7h.01',
}

export function Icon({
  name,
  size = 16,
  stroke = 1.6,
  className = '',
  style,
}: {
  name: string
  size?: number
  stroke?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block', ...style }}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export function StateBadge({
  state,
  size = 'md',
  solid = false,
}: {
  state: State
  size?: 'sm' | 'md'
  solid?: boolean
}) {
  const m = STATE_META[state] || STATE_META.todo
  const cls = `badge badge-${m.v} ${size === 'sm' ? 'badge-sm' : ''} ${solid ? 'badge-solid' : ''}`
  return (
    <span className={cls}>
      <span className="badge-dot" />
      {m.label}
    </span>
  )
}

export function Avatar({
  actorId,
  actors,
  size = 22,
  ring = false,
}: {
  actorId?: string
  actors: Record<string, Actor>
  size?: number
  ring?: boolean
}) {
  const a = (actorId && actors[actorId]) || {
    short: '??',
    kind: 'agent' as const,
    name: actorId || '?',
  }
  const human = a.kind === 'human'
  return (
    <span
      className={`avatar ${human ? 'avatar-human' : 'avatar-agent'} ${ring ? 'avatar-ring' : ''}`}
      title={a.name + (human ? ' (you)' : ' · agent')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {a.short}
    </span>
  )
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  iconRight,
  children,
  className = '',
  onClick,
  disabled,
  title,
  draggable,
  style,
}: {
  variant?: string
  size?: 'sm' | 'md'
  icon?: string
  iconRight?: string
  children?: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  title?: string
  draggable?: boolean
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      draggable={draggable}
      style={style}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 15} />}
    </button>
  )
}

export function ProjectTag({
  project,
  onClick,
  active,
}: {
  project: string
  onClick?: (e: React.MouseEvent) => void
  active?: boolean
}) {
  return (
    <button
      className={`proj-tag ${active ? 'is-active' : ''}`}
      onClick={onClick}
      title={'git repo: ' + project}
    >
      <Icon name="folder" size={12} stroke={1.7} />
      <span className="mono">{project}</span>
    </button>
  )
}

export function LabelChip({ label }: { label: string }) {
  return (
    <span className="label-chip" title={'label: ' + label}>
      <Icon name="tag" size={11} stroke={1.7} />
      {label}
    </span>
  )
}

export function LabelChips({ labels }: { labels?: string[] }) {
  if (!labels?.length) return null
  return (
    <>
      {labels.map((l) => (
        <LabelChip key={l} label={l} />
      ))}
    </>
  )
}

export function MoveMenu({
  task,
  onAction,
  align = 'left',
}: {
  task: UiTask
  onAction: (task: UiTask, t: Transition) => void
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const trans = transitionsFor(task.state)
  return (
    <span className="movemenu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        className={`movemenu-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Change state"
      >
        <StateBadge state={task.state} size="sm" />
        <Icon name="chevDown" size={12} />
      </button>
      {open && (
        <div
          className={`movemenu-pop ${align === 'right' ? 'align-right' : ''}`}
        >
          <div className="movemenu-label">Move to</div>
          {trans.map((t) => (
            <button
              key={t.to}
              className="movemenu-item"
              onClick={() => {
                setOpen(false)
                onAction(task, t)
              }}
            >
              <Icon
                name={t.icon}
                size={13}
                style={{ color: 'var(--text-faint)' }}
              />
              <StateBadge state={t.to} size="sm" />
              {t.requiresNote && (
                <span className="movemenu-note">needs note</span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
