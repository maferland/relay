import type { State, Transition, UiEvent, UiTask } from './types.ts'

export function lastNote(task: UiTask): UiEvent | null {
  for (let i = task.history.length - 1; i >= 0; i--) {
    if (task.history[i].note) return task.history[i]
  }
  return null
}

export const STATE_META: Record<
  State,
  { label: string; v: State; order: number }
> = {
  todo: { label: 'Todo', v: 'todo', order: 0 },
  doing: { label: 'Doing', v: 'doing', order: 1 },
  review: { label: 'Review', v: 'review', order: 2 },
  done: { label: 'Done', v: 'done', order: 3 },
  blocked: { label: 'Blocked', v: 'blocked', order: 4 },
}

export const STATE_FLOW: State[] = ['todo', 'doing', 'review', 'done']

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
          to: 'done',
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
    case 'done':
      return [
        { to: 'doing', label: 'Reopen', icon: 'sync', requiresNote: true },
      ]
    default:
      return []
  }
}

const ORDER: Record<string, number> = { todo: 0, doing: 1, review: 2, done: 3 }

// Transition between two arbitrary states (drag-to-move on the Kanban).
export function transitionMeta(from: State, to: State): Transition {
  const backward = from in ORDER && to in ORDER && ORDER[to] < ORDER[from]
  const requiresNote = to === 'blocked' || backward || from === 'done'
  let label: string
  if (to === 'blocked') label = 'Block task'
  else if (backward) label = 'Send back to ' + STATE_META[to].label
  else if (to === 'done') label = from === 'review' ? 'Pass QA' : 'Mark done'
  else if (from === 'blocked') label = 'Unblock to ' + STATE_META[to].label
  else label = 'Move to ' + STATE_META[to].label
  return {
    to,
    from,
    requiresNote,
    danger: to === 'blocked' || backward,
    good: to === 'done',
    label,
    icon:
      to === 'blocked'
        ? 'alert'
        : backward
          ? 'arrowLeft'
          : to === 'done'
            ? 'check'
            : 'arrowRight',
  }
}
