import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_FILTERS,
  parseLocation,
  stateToLocation,
  type RouteState,
} from './router.ts'

describe('parseLocation', () => {
  test('root → inbox', () => {
    expect(parseLocation('/', '')).toEqual({
      screen: 'inbox',
      taskId: null,
      board: { ...DEFAULT_FILTERS },
    })
  })

  test('bare /board → board with default filters', () => {
    expect(parseLocation('/board', '')).toEqual({
      screen: 'board',
      taskId: null,
      board: { ...DEFAULT_FILTERS },
    })
  })

  test('/board?project=<p> → board filtered to a repo', () => {
    expect(parseLocation('/board', '?project=relay')).toEqual({
      screen: 'board',
      taskId: null,
      board: { ...DEFAULT_FILTERS, proj: 'relay' },
    })
  })

  test('/board with all filters', () => {
    const route = parseLocation(
      '/board',
      '?project=relay&q=foo&state=review,doing&mine=1&since=24h'
    )
    expect(route.board).toEqual({
      proj: 'relay',
      q: 'foo',
      states: ['doing', 'review'],
      mineOnly: true,
      since: '24h',
    })
  })

  test('drops unknown state values and dedupes', () => {
    expect(
      parseLocation('/board', '?state=review,bogus,review').board.states
    ).toEqual(['review'])
  })

  test('falls back to any for an unknown since window', () => {
    expect(parseLocation('/board', '?since=decade').board.since).toBe('any')
  })

  test('/task/<id> → detail', () => {
    expect(parseLocation('/task/task-3b5741f5', '')).toEqual({
      screen: 'detail',
      taskId: 'task-3b5741f5',
      board: { ...DEFAULT_FILTERS },
    })
  })

  test('decodes an encoded task id', () => {
    expect(parseLocation('/task/a%2Fb', '').taskId).toBe('a/b')
  })

  test('decodes an encoded project param', () => {
    expect(parseLocation('/board', '?project=my%20repo').board.proj).toBe(
      'my repo'
    )
  })

  test('unknown path falls back to inbox', () => {
    expect(parseLocation('/nope/whatever', '?x=1').screen).toBe('inbox')
  })
})

describe('stateToLocation', () => {
  test('inbox → /', () => {
    expect(
      stateToLocation({
        screen: 'inbox',
        taskId: null,
        board: { ...DEFAULT_FILTERS },
      })
    ).toEqual({ pathname: '/', search: '' })
  })

  test('board with no filters → bare /board', () => {
    expect(
      stateToLocation({
        screen: 'board',
        taskId: null,
        board: { ...DEFAULT_FILTERS },
      })
    ).toEqual({ pathname: '/board', search: '' })
  })

  test('board with a project → /board?project=<p>', () => {
    expect(
      stateToLocation({
        screen: 'board',
        taskId: null,
        board: { ...DEFAULT_FILTERS, proj: 'relay' },
      })
    ).toEqual({ pathname: '/board', search: '?project=relay' })
  })

  test('detail → /task/<id> with encoding', () => {
    expect(
      stateToLocation({
        screen: 'detail',
        taskId: 'a/b',
        board: { ...DEFAULT_FILTERS },
      })
    ).toEqual({ pathname: '/task/a%2Fb', search: '' })
  })
})

describe('round-trips', () => {
  const cases: RouteState[] = [
    { screen: 'inbox', taskId: null, board: { ...DEFAULT_FILTERS } },
    { screen: 'board', taskId: null, board: { ...DEFAULT_FILTERS } },
    {
      screen: 'board',
      taskId: null,
      board: { ...DEFAULT_FILTERS, proj: 'relay' },
    },
    {
      screen: 'board',
      taskId: null,
      board: {
        proj: 'relay',
        q: 'login bug',
        states: ['todo', 'review'],
        mineOnly: true,
        since: '7d',
      },
    },
    {
      screen: 'detail',
      taskId: 'task-3b5741f5',
      board: { ...DEFAULT_FILTERS },
    },
  ]

  test.each(cases)('state → location → state is stable: %o', (route) => {
    const { pathname, search } = stateToLocation(route)
    expect(parseLocation(pathname, search)).toEqual(route)
  })
})
