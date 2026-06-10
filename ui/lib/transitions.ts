import type { State, Transition, UiEvent, UiTask } from './types.ts'

export function lastNote(task: UiTask): UiEvent | null {
  for (let i = task.history.length - 1; i >= 0; i--) {
    if (task.history[i].note) return task.history[i]
  }
  return null
}

// Why a task needs attention: the escalation reason when it needs a human, else
// the note from the transition into its current state. Never a plain comment.
export function attentionNote(task: UiTask): UiEvent | null {
  const find = (pred: (e: UiEvent) => boolean): UiEvent | null => {
    for (let i = task.history.length - 1; i >= 0; i--) {
      if (task.history[i].note && pred(task.history[i])) return task.history[i]
    }
    return null
  }
  if (task.needsHuman) {
    const escalated = find((e) => e.kind === 'escalate')
    if (escalated) return escalated
  }
  if (task.state === 'review' || task.state === 'blocked') {
    const handoff = find((e) => e.to === task.state)
    if (handoff) return handoff
  }
  return find((e) => e.kind !== 'comment')
}

export const STATE_META: Record<
  State,
  { label: string; v: State; order: number }
> = {
  todo: { label: 'Todo', v: 'todo', order: 0 },
  doing: { label: 'Doing', v: 'doing', order: 1 },
  review: { label: 'Review', v: 'review', order: 2 },
  ready: { label: 'Ready', v: 'ready', order: 3 },
  merged: { label: 'Merged', v: 'merged', order: 4 },
  blocked: { label: 'Blocked', v: 'blocked', order: 5 },
}

export const STATE_FLOW: State[] = [
  'todo',
  'doing',
  'review',
  'ready',
  'merged',
]

export function transitionsFor(state: State): Transition[] {
  switch (state) {
    case 'todo':
      return [
        { to: 'doing', label: 'Start task', icon: 'arrowRight', primary: true },
        {
          to: 'blocked',
          label: 'Block',
          icon: 'alert',
          requiresNote: true,
          danger: true,
        },
      ]
    case 'doing':
      return [
        { to: 'review', label: 'Send to review', icon: 'send', primary: true },
        {
          to: 'blocked',
          label: 'Block',
          icon: 'alert',
          requiresNote: true,
          danger: true,
        },
      ]
    case 'review':
      return [
        {
          to: 'ready',
          label: 'Pass QA',
          icon: 'check',
          primary: true,
          good: true,
        },
        {
          to: 'todo',
          label: 'Reject',
          icon: 'arrowLeft',
          requiresNote: true,
          danger: true,
        },
        { to: 'blocked', label: 'Block', icon: 'alert', requiresNote: true },
      ]
    case 'ready':
      return [
        {
          to: 'merged',
          label: 'Merge',
          icon: 'check',
          primary: true,
          good: true,
        },
        {
          to: 'doing',
          label: 'Send back',
          icon: 'arrowLeft',
          requiresNote: true,
          danger: true,
        },
      ]
    case 'blocked':
      return [
        {
          to: 'doing',
          label: 'Unblock & resume',
          icon: 'arrowRight',
          primary: true,
        },
        { to: 'todo', label: 'Send to backlog', icon: 'arrowLeft' },
      ]
    case 'merged':
      return [
        { to: 'doing', label: 'Reopen', icon: 'sync', requiresNote: true },
      ]
    default:
      return []
  }
}

const ORDER: Record<string, number> = {
  todo: 0,
  doing: 1,
  review: 2,
  ready: 3,
  merged: 4,
}

// Transition between two arbitrary states (drag-to-move on the Kanban).
export function transitionMeta(from: State, to: State): Transition {
  const backward = from in ORDER && to in ORDER && ORDER[to] < ORDER[from]
  const requiresNote = to === 'blocked' || backward || from === 'merged'
  let label: string
  if (to === 'blocked') label = 'Block task'
  else if (backward) label = 'Send back to ' + STATE_META[to].label
  else if (to === 'merged') label = 'Merge'
  else if (to === 'ready') label = from === 'review' ? 'Pass QA' : 'Mark ready'
  else if (from === 'blocked') label = 'Unblock to ' + STATE_META[to].label
  else label = 'Move to ' + STATE_META[to].label
  return {
    to,
    from,
    requiresNote,
    danger: to === 'blocked' || backward,
    good: to === 'merged' || to === 'ready',
    label,
    icon:
      to === 'blocked'
        ? 'alert'
        : backward
          ? 'arrowLeft'
          : to === 'merged' || to === 'ready'
            ? 'check'
            : 'arrowRight',
  }
}
