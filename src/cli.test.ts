import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Task } from './types.js'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.ts')

describe('tasks CLI', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-cli-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  async function run(
    args: string[],
    actor = 'tester',
    extraEnv: Record<string, string> = {}
  ) {
    const proc = Bun.spawn(['bun', CLI, ...args], {
      env: {
        ...process.env,
        RELAY_DIR: dir,
        RELAY_ACTOR: actor,
        XDG_CONFIG_HOME: dir,
        ...extraEnv,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode }
  }

  async function addTask(title: string, extra: string[] = []): Promise<Task> {
    const { stdout, exitCode } = await run([
      'add',
      title,
      '--project',
      'demo',
      '--json',
      ...extra,
    ])
    expect(exitCode).toBe(0)
    return JSON.parse(stdout) as Task
  }

  it('logs a task in todo with a creation event', async () => {
    const task = await addTask('fix login')
    expect(task.state).toBe('todo')
    expect(task.title).toBe('fix login')
    expect(task.createdBy).toBe('tester')
    expect(task.history[0]).toMatchObject({ to: 'todo', note: 'created' })
  })

  it('runs the full QA-handoff loop', async () => {
    const { id } = await addTask('fix login', ['--assignee', 'worker-1'])

    const claimed = JSON.parse(
      (await run(['claim', id, '--json'], 'worker-1')).stdout
    ) as Task
    expect(claimed.state).toBe('doing')
    expect(claimed.assignee).toBe('worker-1')

    const review = JSON.parse(
      (
        await run(
          [
            'update',
            id,
            '--state',
            'review',
            '--note',
            'ready for QA',
            '--json',
          ],
          'worker-1'
        )
      ).stdout
    ) as Task
    expect(review.state).toBe('review')

    // coordinator polls for the handoff
    const list = JSON.parse(
      (
        await run(
          ['list', '--state', 'review', '--project', 'demo', '--json'],
          'lead'
        )
      ).stdout
    ) as Task[]
    expect(list.map((t) => t.id)).toContain(id)

    const ready = JSON.parse(
      (
        await run(
          ['update', id, '--state', 'ready', '--note', 'QA passed', '--json'],
          'lead'
        )
      ).stdout
    ) as Task
    expect(ready.state).toBe('ready')

    const merged = JSON.parse(
      (
        await run(
          [
            'update',
            id,
            '--state',
            'merged',
            '--tested',
            '--note',
            'shipped',
            '--json',
          ],
          'lead'
        )
      ).stdout
    ) as Task
    expect(merged.state).toBe('merged')
    expect(merged.history.map((e) => e.to)).toEqual([
      'todo',
      'doing',
      'review',
      'ready',
      'merged',
    ])
  })

  it('requires a note when QA sends a task back, and records the exchange', async () => {
    const { id } = await addTask('fix login', ['--assignee', 'worker-1'])
    await run(
      ['update', id, '--state', 'review', '--note', 'ready', '--json'],
      'worker-1'
    )

    // QA rejects without a note → blocked
    const noNote = await run(['update', id, '--state', 'todo'], 'qa')
    expect(noNote.exitCode).toBe(1)
    expect(noNote.stderr).toMatch(/note is required/)

    // QA rejects with a note → allowed, note lands in history
    const rejected = JSON.parse(
      (
        await run(
          [
            'update',
            id,
            '--state',
            'todo',
            '--note',
            'missing tests',
            '--json',
          ],
          'qa'
        )
      ).stdout
    ) as Task
    expect(rejected.state).toBe('todo')
    expect(rejected.history.at(-1)).toMatchObject({
      from: 'review',
      to: 'todo',
      actor: 'qa',
      note: 'missing tests',
    })
  })

  it('records plan and clears assignee with an empty string', async () => {
    const created = await addTask('ship it', [
      '--plan',
      '1. write 2. test',
      '--assignee',
      'bob',
    ])
    expect(created.plan).toBe('1. write 2. test')

    const cleared = JSON.parse(
      (await run(['update', created.id, '--assignee', '', '--json'])).stdout
    ) as Task
    expect(cleared.assignee).toBeUndefined()
  })

  it('refuses to claim a task in review', async () => {
    const { id } = await addTask('x')
    await run(['claim', id], 'w1')
    await run(['update', id, '--state', 'review', '--note', 'ready'], 'w1')
    const { exitCode, stderr } = await run(['claim', id], 'w2')
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/reopen/)
  })

  it('requires a note to create a task directly in blocked', async () => {
    const { exitCode, stderr } = await run([
      'add',
      'stuck',
      '--project',
      'demo',
      '--state',
      'blocked',
    ])
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/note is required/)
  })

  it('rejects an unknown state', async () => {
    const { id } = await addTask('x')
    const { exitCode, stderr } = await run(['update', id, '--state', 'bogus'])
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/Invalid --state/)
  })

  it('escalates a task and surfaces it in the human inbox (--needs-human)', async () => {
    const { id } = await addTask('flaky test', ['--assignee', 'worker-1'])
    await run(['claim', id], 'worker-1')
    const escalated = JSON.parse(
      (
        await run(
          ['escalate', id, '--note', 'need staging creds', '--json'],
          'worker-1'
        )
      ).stdout
    ) as Task
    expect(escalated.needsHuman).toBe(true)

    const inbox = JSON.parse(
      (await run(['list', '--needs-human', '--project', 'demo', '--json']))
        .stdout
    ) as Task[]
    expect(inbox.map((t) => t.id)).toContain(id)

    const resolved = JSON.parse(
      (await run(['resolve', id, '--note', 'done', '--json'])).stdout
    ) as Task
    expect(resolved.needsHuman).toBeUndefined()
  })

  it('--mine lists tasks assigned to the current actor', async () => {
    const mine = await addTask('for me', ['--assignee', 'me'])
    await addTask('for someone else', ['--assignee', 'other'])
    const list = JSON.parse(
      (await run(['list', '--mine', '--project', 'demo', '--json'], 'me'))
        .stdout
    ) as Task[]
    expect(list.map((t) => t.id)).toEqual([mine.id])
  })

  it('--json on an empty list still signals the scope on stderr', async () => {
    const { stdout, stderr } = await run([
      'list',
      '--needs-human',
      '--project',
      'demo',
      '--json',
    ])
    expect(stdout.trim()).toBe('[]')
    expect(stderr).toMatch(/No tasks match/)
  })

  it('--help prints usage and exits 0', async () => {
    const { exitCode, stdout } = await run(['list', '--help'])
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/escalate/)
  })

  describe('arg parsing', () => {
    it('errors on an unknown flag instead of silently dropping content', async () => {
      const { exitCode, stderr } = await run([
        'add',
        'fix',
        'the',
        '--bug',
        'now',
        '--project',
        'demo',
      ])
      expect(exitCode).toBe(2)
      expect(stderr).toMatch(/Unknown flag: --bug/)
    })

    it('errors when a value flag is missing its value', async () => {
      expect(
        (await run(['add', 'x', '--project', 'demo', '--note'])).exitCode
      ).toBe(2)
      expect(
        (await run(['add', 'x', '--project', 'demo', '--assignee', '--json']))
          .exitCode
      ).toBe(2)
    })

    it('rejects an empty --state', async () => {
      const { exitCode, stderr } = await run([
        'add',
        'x',
        '--project',
        'demo',
        '--state',
        '',
      ])
      expect(exitCode).toBe(2)
      expect(stderr).toMatch(/Invalid --state/)
    })

    it('treats tokens after -- as the title', async () => {
      const { stdout, exitCode } = await run([
        'add',
        '--project',
        'demo',
        '--json',
        '--',
        '--urgent',
        'fix',
        'it',
      ])
      expect(exitCode).toBe(0)
      expect((JSON.parse(stdout) as Task).title).toBe('--urgent fix it')
    })
  })

  it('errors on a missing task id', async () => {
    const { exitCode, stderr } = await run([
      'update',
      'task-missing',
      '--state',
      'merged',
    ])
    expect(exitCode).toBe(1)
    expect(stderr).toMatch(/not found/)
  })

  it('keeps every history entry under concurrent updates from separate processes', async () => {
    const { id } = await addTask('hot')
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        run(['update', id, '--note', `n${i}`], `w${i}`)
      )
    )
    const task = JSON.parse((await run(['show', id, '--json'])).stdout) as Task
    expect(task.history.length).toBe(21) // creation + 20 separate-process updates, none lost
    expect(new Set(task.history.slice(1).map((e) => e.note)).size).toBe(20)
  })

  it('prints help and exits 0 with no command', async () => {
    const { exitCode, stderr } = await run([])
    expect(exitCode).toBe(0)
    expect(stderr).toMatch(/local-first task tracker/)
  })

  it('--version prints a version and exits 0', async () => {
    const { exitCode, stdout } = await run(['--version'])
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toMatch(/^(\d+\.\d+\.\d+|dev)$/)
  })

  describe('completion', () => {
    it.each(['bash', 'zsh', 'fish'])('emits a %s script', async (sh) => {
      const { stdout, exitCode } = await run(['completion', sh])
      expect(exitCode).toBe(0)
      expect(stdout).toContain('relay')
      expect(stdout).toContain('comment')
    })

    it('rejects an unknown shell with exit 2', async () => {
      const { exitCode, stderr } = await run(['completion', 'powershell'])
      expect(exitCode).toBe(2)
      expect(stderr).toMatch(/usage: relay completion/)
    })

    it.each([
      ['fish', ['fish', 'completions', 'relay.fish']],
      ['bash', ['bash-completion', 'completions', 'relay']],
      ['zsh', ['zsh', 'site-functions', '_relay']],
    ])('--install writes the %s script to disk', async (sh, segments) => {
      const { stdout, stderr, exitCode } = await run(
        ['completion', sh, '--install'],
        'tester',
        { XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir }
      )
      expect(exitCode).toBe(0)
      expect(stdout).toBe('') // script goes to disk, not stdout
      expect(stderr).toContain('Wrote')
      const target = path.join(dir, ...(segments as string[]))
      expect(fs.readFileSync(target, 'utf8')).toContain('relay')
    })
  })

  describe('config', () => {
    it('set/get name round-trips', async () => {
      const set = await run(['config', 'set', 'name', 'Marc Test'])
      expect(set.exitCode).toBe(0)
      const get = await run(['config', 'get', 'name'])
      expect(get.exitCode).toBe(0)
      expect(get.stdout.trim()).toBe('Marc Test')
    })

    it('prints the whole config when given no key', async () => {
      await run(['config', 'set', 'name', 'Marc'])
      const { stdout } = await run(['config'])
      expect(JSON.parse(stdout)).toEqual({ name: 'Marc' })
    })

    it('rejects a bad set with exit 2', async () => {
      const { exitCode, stderr } = await run(['config', 'set', 'name'])
      expect(exitCode).toBe(2)
      expect(stderr).toMatch(/usage: relay config/)
    })
  })

  describe('human checkpoints', () => {
    it('sets the tested flag with --tested', async () => {
      const { id } = await addTask('x')
      const updated = JSON.parse(
        (await run(['update', id, '--tested', '--json'])).stdout
      ) as Task
      expect(updated.humanTested).toBe(true)
    })

    it('blocks merged without --tested, allows it with', async () => {
      const { id } = await addTask('x', ['--assignee', 'w1'])
      await run(['update', id, '--state', 'review', '--note', 'ready'], 'w1')
      const blocked = await run(['update', id, '--state', 'merged'])
      expect(blocked.exitCode).toBe(1)
      expect(blocked.stderr).toMatch(/never human-tested/)
      const ok = JSON.parse(
        (await run(['update', id, '--state', 'merged', '--tested', '--json']))
          .stdout
      ) as Task
      expect(ok.state).toBe('merged')
      expect(ok.humanTested).toBe(true)
    })

    it('clears the tested flag with --clear-tested', async () => {
      const { id } = await addTask('x')
      await run(['update', id, '--tested'])
      const cleared = JSON.parse(
        (await run(['update', id, '--clear-tested', '--json'])).stdout
      ) as Task
      expect(cleared.humanTested).toBeUndefined()
    })
  })

  describe('labels', () => {
    it('sets, adjusts, and filters by labels', async () => {
      const { id } = await addTask('labelled', ['--label', 'backend,api'])
      const after = JSON.parse(
        (
          await run([
            'update',
            id,
            '--add-label',
            'code-reviewed',
            '--rm-label',
            'api',
            '--json',
          ])
        ).stdout
      ) as Task
      expect(after.labels!.sort()).toEqual(['backend', 'code-reviewed'])

      const hit = JSON.parse(
        (
          await run([
            'list',
            '--label',
            'code-reviewed',
            '--project',
            'demo',
            '--json',
          ])
        ).stdout
      ) as Task[]
      expect(hit.map((t) => t.id)).toContain(id)

      const miss = await run([
        'list',
        '--label',
        'nope',
        '--project',
        'demo',
        '--json',
      ])
      expect(miss.stdout.trim()).toBe('[]')
    })
  })

  describe('link', () => {
    it('attaches a GitHub PR link with --pr', async () => {
      const { id } = await addTask('has a pr')
      const after = JSON.parse(
        (await run(['link', id, '--pr', 'maferland/relay#1', '--json'])).stdout
      ) as Task & {
        links?: { system: string; kind: string; ref: string; url?: string }[]
      }
      expect(after.links).toHaveLength(1)
      expect(after.links![0]).toMatchObject({
        system: 'github',
        kind: 'pr',
        ref: 'maferland/relay#1',
        url: 'https://github.com/maferland/relay/pull/1',
      })
    })
  })

  describe('comment', () => {
    it('appends a note-only event without changing state', async () => {
      const { id } = await addTask('discuss', ['--assignee', 'w1'])
      const after = JSON.parse(
        (await run(['comment', id, 'what did you mean by X?', '--json'], 'qa'))
          .stdout
      ) as Task
      expect(after.state).toBe('todo')
      const last = after.history.at(-1)!
      expect(last).toMatchObject({
        actor: 'qa',
        note: 'what did you mean by X?',
        kind: 'comment',
      })
      expect(last.from).toBeUndefined()
      expect(last.to).toBeUndefined()
    })

    it('errors with exit 2 when the message is empty', async () => {
      const { id } = await addTask('x')
      const { exitCode, stderr } = await run(['comment', id])
      expect(exitCode).toBe(2)
      expect(stderr).toMatch(/usage: relay comment/)
    })
  })

  describe('watch', () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    // Start the CLI without awaiting, so the caller can mutate the store mid-watch.
    function spawnCli(args: string[], actor = 'tester') {
      const proc = Bun.spawn(['bun', CLI, ...args], {
        env: { ...process.env, RELAY_DIR: dir, RELAY_ACTOR: actor },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      return {
        proc,
        async result() {
          const [stdout, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            proc.exited,
          ])
          return { stdout, exitCode }
        },
      }
    }

    it('blocks until the task changes, then returns it with exit 0', async () => {
      const { id } = await addTask('watch me', ['--assignee', 'w1'])
      const watch = spawnCli([
        'watch',
        id,
        '--interval',
        '0.2',
        '--timeout',
        '10',
        '--json',
      ])
      await sleep(500)
      await run(['update', id, '--note', 'ping'], 'w1')
      const { stdout, exitCode } = await watch.result()
      expect(exitCode).toBe(0)
      const task = JSON.parse(stdout) as Task
      expect(task.history.at(-1)).toMatchObject({ note: 'ping' })
    })

    it('times out with exit 3 when nothing changes', async () => {
      const { id } = await addTask('quiet')
      const { exitCode, stderr } = await run([
        'watch',
        id,
        '--interval',
        '0.2',
        '--timeout',
        '0.6',
      ])
      expect(exitCode).toBe(3)
      expect(stderr).toMatch(/timed out/i)
    })

    it('errors with exit 2 on a missing id', async () => {
      const { exitCode, stderr } = await run([
        'watch',
        'task-nope',
        '--timeout',
        '1',
      ])
      expect(exitCode).toBe(2)
      expect(stderr).toMatch(/not found/)
    })

    it('--continuous emits one ndjson line per change and exits on timeout', async () => {
      const { id } = await addTask('streaming', ['--assignee', 'w1'])
      await run(['claim', id], 'w1')
      const watch = spawnCli([
        'watch',
        id,
        '--continuous',
        '--json',
        '--interval',
        '0.2',
        '--timeout',
        '5',
      ])
      await sleep(400)
      await run(['update', id, '--note', 'event-1'], 'w1')
      await sleep(400)
      await run(['update', id, '--note', 'event-2'], 'w1')
      await sleep(400)
      watch.proc.kill()
      const { stdout } = await watch.result()
      const lines = stdout.trim().split('\n').filter(Boolean)
      expect(lines.length).toBeGreaterThanOrEqual(2)
      const notes = lines
        .map((l) => JSON.parse(l) as Task)
        .map((t) => t.history.at(-1)?.note)
      expect(notes).toContain('event-1')
      expect(notes).toContain('event-2')
    })

    it('--state blocks until a task enters that queue', async () => {
      const { id } = await addTask('q', ['--assignee', 'w1'])
      const watch = spawnCli([
        'watch',
        '--state',
        'review',
        '--project',
        'demo',
        '--interval',
        '0.2',
        '--timeout',
        '10',
        '--json',
      ])
      await sleep(500)
      await run(['claim', id], 'w1')
      await run(['update', id, '--state', 'review', '--note', 'ready'], 'w1')
      const { stdout, exitCode } = await watch.result()
      expect(exitCode).toBe(0)
      expect((JSON.parse(stdout) as Task[]).map((t) => t.id)).toContain(id)
    })

    it('--state surfaces a task already waiting in that queue on the first poll', async () => {
      const { id } = await addTask('already in review', ['--assignee', 'w1'])
      await run(['claim', id], 'w1')
      await run(['update', id, '--state', 'review', '--note', 'qa pls'], 'w1')
      const { stdout, exitCode } = await run([
        'watch',
        '--state',
        'review',
        '--project',
        'demo',
        '--interval',
        '0.2',
        '--timeout',
        '5',
        '--json',
      ])
      expect(exitCode).toBe(0)
      expect((JSON.parse(stdout) as Task[]).map((t) => t.id)).toContain(id)
    })

    it('with no --state, wakes on any change in the project', async () => {
      const { id } = await addTask('any change', ['--assignee', 'w1'])
      const watch = spawnCli([
        'watch',
        '--project',
        'demo',
        '--interval',
        '0.2',
        '--timeout',
        '10',
        '--json',
      ])
      await sleep(500)
      await run(['update', id, '--note', 'poke'], 'w1')
      const { stdout, exitCode } = await watch.result()
      expect(exitCode).toBe(0)
      expect((JSON.parse(stdout) as Task[]).map((t) => t.id)).toContain(id)
    })
  })
})
