import { useCallback, useEffect, useState } from 'react'
import type { State } from './types.ts'

// Pathname-based History API routing: /board carries every board filter as a uniform query
// param (project included, omitted when unset). Server serves the SPA for any non-API path.

export type Screen = 'inbox' | 'board' | 'detail'
export type SinceWindow = 'any' | '1h' | '24h' | '7d'

const SINCE_VALUES: SinceWindow[] = ['any', '1h', '24h', '7d']

export interface BoardFilters {
  proj: string | null
  q: string
  states: State[]
  mineOnly: boolean
  since: SinceWindow
}

export interface RouteState {
  screen: Screen
  taskId: string | null
  board: BoardFilters
}

const BOARD_STATES: State[] = [
  'todo',
  'doing',
  'review',
  'ready',
  'merged',
  'blocked',
]

export const DEFAULT_FILTERS: BoardFilters = {
  proj: null,
  q: '',
  states: [],
  mineOnly: false,
  since: 'any',
}

function parseStates(raw: string | null): State[] {
  if (!raw) return []
  const seen = new Set<State>()
  for (const part of raw.split(',')) {
    const s = part.trim()
    if ((BOARD_STATES as string[]).includes(s)) seen.add(s as State)
  }
  return BOARD_STATES.filter((s) => seen.has(s))
}

function parseSince(raw: string | null): SinceWindow {
  return raw && (SINCE_VALUES as string[]).includes(raw)
    ? (raw as SinceWindow)
    : 'any'
}

function parseBoardFilters(search: string): BoardFilters {
  const params = new URLSearchParams(search)
  return {
    proj: params.get('project') || null,
    q: params.get('q') ?? '',
    states: parseStates(params.get('state')),
    mineOnly: params.get('mine') === '1',
    since: parseSince(params.get('since')),
  }
}

// Unknown paths fall back to the inbox.
export function parseLocation(pathname: string, search: string): RouteState {
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (segments.length === 0) {
    return { screen: 'inbox', taskId: null, board: { ...DEFAULT_FILTERS } }
  }

  if (segments[0] === 'task' && segments.length === 2) {
    return {
      screen: 'detail',
      taskId: segments[1],
      board: { ...DEFAULT_FILTERS },
    }
  }

  if (segments[0] === 'board' && segments.length === 1) {
    return {
      screen: 'board',
      taskId: null,
      board: parseBoardFilters(search),
    }
  }

  return { screen: 'inbox', taskId: null, board: { ...DEFAULT_FILTERS } }
}

export function stateToLocation(state: RouteState): {
  pathname: string
  search: string
} {
  if (state.screen === 'inbox') return { pathname: '/', search: '' }

  if (state.screen === 'detail' && state.taskId) {
    return { pathname: `/task/${encodeURIComponent(state.taskId)}`, search: '' }
  }

  const { proj, q, states, mineOnly, since } = state.board

  const params = new URLSearchParams()
  if (proj) params.set('project', proj)
  if (q) params.set('q', q)
  if (states.length) params.set('state', states.join(','))
  if (mineOnly) params.set('mine', '1')
  if (since !== 'any') params.set('since', since)

  const search = params.toString()
  return { pathname: '/board', search: search ? `?${search}` : '' }
}

function currentLocation(): RouteState {
  return parseLocation(window.location.pathname, window.location.search)
}

// Thin hook over History + popstate; navigate pushes only when the URL actually changes.
export function useRouter(): {
  route: RouteState
  navigate: (next: RouteState) => void
} {
  const [route, setRoute] = useState<RouteState>(currentLocation)

  useEffect(() => {
    const onPop = () => setRoute(currentLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: RouteState) => {
    const { pathname, search } = stateToLocation(next)
    const url = pathname + search
    if (url !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', url)
    }
    setRoute(next)
  }, [])

  return { route, navigate }
}
