import fs from 'fs'
import path from 'path'
import { buildTask, SqliteTaskStore } from './store.js'
import {
  isState,
  STATES,
  type State,
  type Task,
  type TaskChanges,
  type TaskLink,
} from './types.js'
import { syncLink } from './connectors/index.js'
import {
  detectProject,
  gitContext,
  openBrowser,
  resolveActor,
  resolveActorKind,
  SESSION_ID,
  taskDetailUrl,
} from './util.js'
import { operatorName, readConfig, writeConfig } from './config.js'
import { AgentRegistry } from './agents.js'
import { upgradeCommand } from './upgrade.js'
import { maybeNudge } from './update-check.js'
import { VERSION } from './version.js'
import {
  completionScript,
  completionTarget,
  COMPLETION_SHELLS,
  isCompletionShell,
  reloadHint,
} from './completion.js'

const BOOL_FLAGS = new Set([
  'all',
  'json',
  'needs-human',
  'mine',
  'help',
  'remote',
  'install',
  'reviewed',
  'tested',
  'clear-reviewed',
  'clear-tested',
  'force',
  'watch',
  'set',
  'continuous',
])
const VALUE_FLAGS = new Set([
  'desc',
  'plan',
  'assignee',
  'project',
  'state',
  'note',
  'title',
  'branch',
  'worktree',
  'actor',
  'since',
  'me',
  'port',
  'interval',
  'timeout',
  'label',
  'add-label',
  'rm-label',
  'pr',
  'expect-state',
  'watcher',
  'ttl',
])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Split a comma-separated flag value into trimmed, non-empty labels.
function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

interface ParsedArgs {
  command: string
  positional: string[]
  flags: Record<string, string | boolean>
}

function die(msg: string, code = 1): never {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n')
  process.exit(code)
}

// Known-flag parser: unknown flags and missing/flag-shaped values are loud errors,
// so a dashed word in a title can't silently corrupt the command. `--` ends options.
function parseArgs(argv: string[]): ParsedArgs {
  const [command = '', ...rest] = argv
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--') {
      positional.push(...rest.slice(i + 1))
      break
    }
    if (arg === '-h') {
      flags.help = true
      continue
    }
    if (arg.startsWith('--')) {
      const name = arg.slice(2)
      if (BOOL_FLAGS.has(name)) {
        flags[name] = true
        continue
      }
      if (!VALUE_FLAGS.has(name)) die(`Unknown flag: --${name}`, 2)
      const value = rest[i + 1]
      if (value === undefined || value === '--' || value.startsWith('--')) {
        die(`--${name} requires a value`, 2)
      }
      flags[name] = value
      i++
      continue
    }
    positional.push(arg)
  }
  return { command, positional, flags }
}

// The raw value of a flag when present (preserves "" so a field can be cleared); else undefined.
function val(flag: string | boolean | undefined): string | undefined {
  return typeof flag === 'string' ? flag : undefined
}

function requireState(value: string | undefined): State | undefined {
  if (value === undefined) return undefined
  if (!isState(value))
    die(
      `Invalid --state: ${value || '(empty)'} (expected ${STATES.join('|')})`,
      2
    )
  return value
}

function short(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + ' '.repeat(width - value.length)
}

function printTask(task: Task, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(task, null, 2) + '\n')
    return
  }
  const where =
    task.branch || task.worktree
      ? `\n  branch: ${task.branch ?? '—'}   worktree: ${task.worktree ?? '—'}`
      : ''
  const flag = task.needsHuman ? '  ** NEEDS HUMAN **' : ''
  const labels = task.labels?.length
    ? `\n  labels: ${task.labels.join(', ')}`
    : ''
  const checked = [
    task.humanReviewed ? 'reviewed' : null,
    task.humanTested ? 'tested' : null,
  ].filter(Boolean)
  const checks = checked.length ? `\n  human: ${checked.join(', ')}` : ''
  const watcherLine = task.watcher ? `   watcher: ${task.watcher}` : ''
  process.stdout.write(
    `${task.id}  [${task.state}]${flag}  ${task.title}\n` +
      `  project: ${task.project}   assignee: ${task.assignee ?? '—'}${watcherLine}   updated: ${short(task.updatedAt)}${where}${labels}${checks}\n`
  )
}

function printList(tasks: Task[], json: boolean, scope?: string): void {
  // Signal the active scope on an empty result (even in JSON) so a bare [] isn't misread.
  if (tasks.length === 0) {
    const hint = scope
      ? ` in project "${scope}" (use --all to see every project)`
      : ''
    process.stderr.write(`No tasks match${hint}.\n`)
    if (json) process.stdout.write('[]\n')
    return
  }
  if (json) {
    process.stdout.write(JSON.stringify(tasks, null, 2) + '\n')
    return
  }
  const rows = tasks.map((t) => [
    t.id,
    t.needsHuman ? `${t.state}!` : t.state,
    t.assignee ?? '—',
    t.project,
    short(t.updatedAt),
    t.title,
  ])
  const headers = ['ID', 'STATE', 'ASSIGNEE', 'PROJECT', 'UPDATED', 'TITLE']
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  )
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : pad(c, widths[i])))
      .join('  ')
  process.stdout.write(line(headers) + '\n')
  for (const r of rows) process.stdout.write(line(r) + '\n')
}

async function addCommand(args: ParsedArgs): Promise<void> {
  const title = args.positional.join(' ').trim()
  if (!title) {
    die(
      'usage: relay add "<title>" [--desc ..] [--plan ..] [--assignee ..] [--project ..] [--state todo]',
      2
    )
  }
  const actorFlag = val(args.flags.actor)
  const actor = resolveActor(actorFlag)
  let task: Task
  try {
    task = buildTask({
      title,
      description: val(args.flags.desc),
      plan: val(args.flags.plan),
      state: requireState(val(args.flags.state)),
      project: val(args.flags.project) ?? detectProject(),
      branch: val(args.flags.branch),
      worktree: val(args.flags.worktree),
      assignee: val(args.flags.assignee),
      labels:
        args.flags.label !== undefined ? csv(val(args.flags.label)) : undefined,
      actor,
      actorKind: resolveActorKind(actorFlag),
      sessionId: SESSION_ID,
      note: val(args.flags.note),
    })
  } catch (e) {
    die(e instanceof Error ? e.message : String(e), 2)
  }
  await new SqliteTaskStore().add(task)
  printTask(task, !!args.flags.json)
}

async function listCommand(args: ParsedArgs): Promise<void> {
  const scope = args.flags.all
    ? undefined
    : (val(args.flags.project) ?? detectProject())
  const tasks = await new SqliteTaskStore().list({
    state: requireState(val(args.flags.state)),
    assignee: args.flags.mine
      ? resolveActor(val(args.flags.actor))
      : val(args.flags.assignee),
    project: scope,
    since: val(args.flags.since),
    needsHuman: !!args.flags['needs-human'],
    labels:
      args.flags.label !== undefined ? csv(val(args.flags.label)) : undefined,
  })
  printList(tasks, !!args.flags.json, scope)
}

async function showCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id) die('usage: relay show <id>', 2)
  const task = await new SqliteTaskStore()
    .get(id)
    .catch((e: Error) => die(e.message))
  if (!task) die(`Task "${id}" not found.`)
  if (args.flags.json) {
    process.stdout.write(JSON.stringify(task, null, 2) + '\n')
    return
  }
  printTask(task, false)
  if (task.description) process.stdout.write(`\n${task.description}\n`)
  if (task.plan) process.stdout.write(`\nplan:\n${task.plan}\n`)
  process.stdout.write('\nhistory:\n')
  for (const e of task.history) {
    const transition =
      e.from || e.to ? `${e.from ?? '·'} → ${e.to ?? '·'}` : 'note'
    process.stdout.write(
      `  ${short(e.at)}  ${pad(e.actor ?? '—', 12)}  ${pad(transition, 16)}${e.note ? '  ' + e.note : ''}\n`
    )
  }
}

async function updateCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id)
    die('usage: relay update <id> [--state ..] [--assignee ..] [--note ..]', 2)
  const changes: TaskChanges = {}
  if (args.flags.state !== undefined)
    changes.state = requireState(val(args.flags.state))
  if (args.flags.assignee !== undefined)
    changes.assignee = val(args.flags.assignee)
  if (args.flags.title !== undefined) changes.title = val(args.flags.title)
  if (args.flags.desc !== undefined) changes.description = val(args.flags.desc)
  if (args.flags.plan !== undefined) changes.plan = val(args.flags.plan)
  if (args.flags.branch !== undefined) changes.branch = val(args.flags.branch)
  if (args.flags.worktree !== undefined)
    changes.worktree = val(args.flags.worktree)
  if (args.flags.label !== undefined)
    changes.labels = csv(val(args.flags.label))
  if (args.flags['add-label'] !== undefined)
    changes.addLabels = csv(val(args.flags['add-label']))
  if (args.flags['rm-label'] !== undefined)
    changes.removeLabels = csv(val(args.flags['rm-label']))
  if (args.flags.reviewed) changes.humanReviewed = true
  if (args.flags['clear-reviewed']) changes.humanReviewed = false
  if (args.flags.tested) changes.humanTested = true
  if (args.flags['clear-tested']) changes.humanTested = false
  if (args.flags['expect-state'] !== undefined)
    changes.expectedState = requireState(val(args.flags['expect-state']))
  if (args.flags.watcher !== undefined)
    changes.watcher = val(args.flags.watcher) ?? null

  const updateActorFlag = val(args.flags.actor)
  const task = await new SqliteTaskStore()
    .update(id, changes, {
      actor: resolveActor(updateActorFlag),
      actorKind: resolveActorKind(updateActorFlag),
      sessionId: SESSION_ID,
      note: val(args.flags.note),
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function claimCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id) die('usage: relay claim <id> [--assignee ..]', 2)
  const claimActorFlag = val(args.flags.actor)
  const actor = resolveActor(claimActorFlag)
  const git = gitContext()
  const task = await new SqliteTaskStore()
    .claim(id, {
      assignee: val(args.flags.assignee) ?? actor,
      actor,
      actorKind: resolveActorKind(claimActorFlag),
      sessionId: SESSION_ID,
      note: val(args.flags.note),
      branch: val(args.flags.branch) ?? git.branch,
      worktree: val(args.flags.worktree) ?? git.worktree,
      force: !!args.flags.force,
      watch: !!args.flags.watch,
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function escalateCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id)
    die('usage: relay escalate <id> --note "<what you need from a human>"', 2)
  const escalateActorFlag = val(args.flags.actor)
  const task = await new SqliteTaskStore()
    .escalate(id, {
      actor: resolveActor(escalateActorFlag),
      actorKind: resolveActorKind(escalateActorFlag),
      sessionId: SESSION_ID,
      note: val(args.flags.note),
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function resolveCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id) die('usage: relay resolve <id> [--note ..]', 2)
  const resolveActorFlag = val(args.flags.actor)
  const task = await new SqliteTaskStore()
    .resolve(id, {
      actor: resolveActor(resolveActorFlag),
      actorKind: resolveActorKind(resolveActorFlag),
      sessionId: SESSION_ID,
      note: val(args.flags.note),
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function commentCommand(args: ParsedArgs): Promise<void> {
  const [id, ...rest] = args.positional
  const note = (val(args.flags.note) ?? rest.join(' ')).trim()
  if (!id || !note)
    die('usage: relay comment <id> "<message>"  (or --note "<message>")', 2)
  const commentActorFlag = val(args.flags.actor)
  const task = await new SqliteTaskStore()
    .comment(id, {
      actor: resolveActor(commentActorFlag),
      actorKind: resolveActorKind(commentActorFlag),
      sessionId: SESSION_ID,
      note,
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

// "owner/repo#123" → its github PR url.
function prUrl(ref: string): string | undefined {
  const m = ref.match(/^(.+)#(\d+)$/)
  return m ? `https://github.com/${m[1]}/pull/${m[2]}` : undefined
}

async function linkCommand(args: ParsedArgs): Promise<void> {
  const pr = val(args.flags.pr)
  const [id, system, kind, ref] = args.positional
  let link: TaskLink | undefined
  if (pr) link = { system: 'github', kind: 'pr', ref: pr, url: prUrl(pr) }
  else if (system && kind && ref) link = { system, kind, ref }
  if (!id || !link)
    die(
      'usage: relay link <id> --pr owner/repo#123   |   relay link <id> <system> <kind> <ref>',
      2
    )
  const task = await new SqliteTaskStore()
    .update(
      id,
      { addLink: link },
      {
        actor: resolveActor(val(args.flags.actor)),
        note: `linked ${link.system}:${link.ref}`,
      }
    )
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function syncCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id) die('usage: relay sync <id>', 2)
  const store = new SqliteTaskStore()
  const task = await store.get(id).catch((e: Error) => die(e.message))
  if (!task) die(`Task "${id}" not found.`)
  if (!task.links?.length) {
    process.stderr.write('No links to sync.\n')
    return
  }
  const actor = resolveActor(val(args.flags.actor))
  let current = task
  let changes = 0
  for (const link of task.links) {
    const updated = await syncLink(store, id, link, actor)
    if (updated) {
      current = updated
      changes++
    }
  }
  process.stderr.write(`Synced ${id}: ${changes} change(s).\n`)
  printTask(current, !!args.flags.json)
}

function printChange(task: Task, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(task, null, 2) + '\n')
    return
  }
  printTask(task, false)
  const e = task.history[task.history.length - 1]
  if (e) {
    const transition =
      e.from || e.to ? `${e.from ?? '·'} → ${e.to ?? '·'}` : 'note'
    process.stdout.write(
      `  changed: ${transition}${e.note ? '  ' + e.note : ''}  (${e.actor ?? '—'})\n`
    )
  }
}

// Block until a task changes. --continuous re-arms after each event (ndjson stream).
async function watchCommand(args: ParsedArgs): Promise<void> {
  const store = new SqliteTaskStore()
  const json = !!args.flags.json
  const continuous = !!args.flags.continuous
  const [id] = args.positional
  const interval = Math.max(
    0.2,
    args.flags.interval ? parseFloat(val(args.flags.interval)!) : 2
  )
  const timeout = args.flags.timeout
    ? parseFloat(val(args.flags.timeout)!)
    : 600
  const deadline = timeout > 0 ? Date.now() + timeout * 1000 : Infinity

  // relay watch --set <id>: register RELAY_ACTOR as watcher without blocking.
  if (args.flags.set) {
    if (!id) die('usage: relay watch --set <id>', 2)
    const actor = resolveActor(val(args.flags.actor))
    const task = await store
      .update(id, { watcher: actor }, { actor, note: `watching` })
      .catch((e: Error) => die(e.message))
    printTask(task, json)
    return
  }

  if (id) {
    const until = requireState(val(args.flags.state))
    const remote = !!args.flags.remote
    const actor = resolveActor(val(args.flags.actor))
    const start = await store.get(id).catch((e: Error) => die(e.message))
    if (!start) die(`Task "${id}" not found.`, 2)
    let baseline = val(args.flags.since) ?? start.updatedAt
    const emit = (t: Task) => {
      if (continuous && json) process.stdout.write(JSON.stringify(t) + '\n')
      else printChange(t, json)
    }
    for (;;) {
      if (remote) {
        const t = await store.get(id)
        for (const link of t?.links ?? []) {
          const changed = await syncLink(store, id, link, actor)
          if (changed) {
            emit(changed)
            if (!continuous) return
            baseline = changed.updatedAt
          }
        }
      }
      const task = await store.get(id)
      if (
        task &&
        task.updatedAt > baseline &&
        (!until || task.state === until)
      ) {
        emit(task)
        if (!continuous) return
        baseline = task.updatedAt
      }
      if (Date.now() >= deadline) {
        if (continuous)
          process.stderr.write(`relay watch: stream ended after ${timeout}s\n`)
        else die(`Timed out after ${timeout}s with no change to ${id}.`, 3)
        return
      }
      await sleep(interval * 1000)
    }
  }

  // Queue mode: block until a task enters --state (current project unless --all).
  const state = requireState(val(args.flags.state))
  if (!state)
    die(
      'usage: relay watch <id> | relay watch --state <state> [--project P|--all]',
      2
    )
  const scope = args.flags.all
    ? undefined
    : (val(args.flags.project) ?? detectProject())
  const baseline = val(args.flags.since) ?? new Date().toISOString()
  for (;;) {
    const entered = (await store.list({ state, project: scope })).filter(
      (t) => t.updatedAt > baseline
    )
    if (entered.length) {
      printList(entered, json)
      return
    }
    if (Date.now() >= deadline)
      die(`Timed out after ${timeout}s; nothing entered ${state}.`, 3)
    await sleep(interval * 1000)
  }
}

function completionCommand(args: ParsedArgs): void {
  const [shell] = args.positional
  if (!shell || !isCompletionShell(shell))
    die(
      `usage: relay completion <${COMPLETION_SHELLS.join('|')}> [--install]`,
      2
    )
  const flags = [...BOOL_FLAGS, ...VALUE_FLAGS].sort()
  const script = completionScript(shell, flags)
  if (!args.flags.install) {
    process.stdout.write(script)
    return
  }
  const target = completionTarget(shell)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, script)
  process.stderr.write(
    `Wrote ${shell} completions to ${target}\n${reloadHint(shell, target)}\n`
  )
}

// `relay config set name "<you>"` / `relay config get [name]` / `relay config`.
function configCommand(args: ParsedArgs): void {
  const usage = 'usage: relay config set name "<you>" | relay config get [name]'
  const [action, key, ...rest] = args.positional
  if (!action || action === 'get') {
    const config = readConfig()
    if (!key) {
      process.stdout.write(JSON.stringify(config, null, 2) + '\n')
      return
    }
    const value = (config as Record<string, unknown>)[key]
    if (value !== undefined) process.stdout.write(String(value) + '\n')
    return
  }
  if (action !== 'set' || key !== 'name') die(usage, 2)
  const name = rest.join(' ').trim()
  if (!name) die(usage, 2)
  writeConfig({ ...readConfig(), name })
  process.stderr.write(`Saved name = ${name}\n`)
}

async function mcpCommand(): Promise<void> {
  const { StdioServerTransport } =
    await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { createServer } = await import('./mcp.js')
  await createServer(new SqliteTaskStore()).connect(new StdioServerTransport())
}

async function uiCommand(args: ParsedArgs): Promise<void> {
  // The bundled SPA lives in ui-html (the only module that depends on the build); a missing
  // build fails this import, which is how we detect "UI not built".
  const htmlMod = await import('./ui-html.js').catch(() => null)
  if (!htmlMod)
    die('UI not built. Run `bun run build` (or `bun run build:ui`) first.')
  const { createUiServer } = await import('./ui-server.js')
  const me =
    val(args.flags.me) ?? operatorName() ?? resolveActor(val(args.flags.actor))
  const port = args.flags.port ? parseInt(val(args.flags.port)!, 10) : undefined
  const server = createUiServer(new SqliteTaskStore(), {
    me,
    port,
    html: htmlMod.loadUiHtml(),
  })
  const url = `http://localhost:${server.port}`
  const [taskId] = args.positional
  process.stderr.write(
    `relay UI on ${url}  (you = ${me})${taskId ? ` — opening ${taskId}` : ''}\n`
  )
  openBrowser(taskDetailUrl(url, taskId))
}

async function registerCommand(args: ParsedArgs): Promise<void> {
  const project = val(args.flags.project) ?? detectProject()
  const ttl = args.flags.ttl ? parseInt(val(args.flags.ttl)!, 10) : undefined
  const registry = new AgentRegistry()
  const agent = registry.register(project, ttl)
  registry.close()
  if (args.flags.json) {
    process.stdout.write(JSON.stringify(agent, null, 2) + '\n')
  } else {
    process.stdout.write(`export RELAY_ACTOR=${agent.name}\n`)
    process.stderr.write(
      `Registered ${agent.name} (project: ${project})\n` +
        `Run the export above to adopt this identity for the session.\n`
    )
  }
}

async function agentsCommand(args: ParsedArgs): Promise<void> {
  const json = !!args.flags.json
  const scope = args.flags.all
    ? undefined
    : (val(args.flags.project) ?? detectProject())
  const ttl = args.flags.ttl ? parseInt(val(args.flags.ttl)!, 10) : undefined
  const registry = new AgentRegistry()
  const agents = registry.list(scope)
  registry.close()
  if (agents.length === 0) {
    const hint = scope
      ? ` in project "${scope}" (use --all to see every project)`
      : ''
    process.stderr.write(`No agents registered${hint}.\n`)
    if (json) process.stdout.write('[]\n')
    return
  }
  if (json) {
    process.stdout.write(
      JSON.stringify(
        agents.map((a) => ({ ...a, status: AgentRegistry.status(a, ttl) })),
        null,
        2
      ) + '\n'
    )
    return
  }
  const rows = agents.map((a) => [
    a.name,
    a.project ?? '—',
    AgentRegistry.status(a, ttl),
    a.lastSeen.slice(0, 16).replace('T', ' '),
  ])
  const headers = ['NAME', 'PROJECT', 'STATUS', 'LAST SEEN']
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  )
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i])))
      .join('  ')
  process.stdout.write(line(headers) + '\n')
  for (const r of rows) process.stdout.write(line(r) + '\n')
}

const HELP =
  'relay — local-first task tracker for multi-agent coordination\n\n' +
  'Commands:\n' +
  '  relay add "<title>" [--desc ..] [--plan ..] [--assignee ..] [--project ..] [--state todo]\n' +
  '  relay list [--state S] [--assignee X] [--project P|--all] [--since ISO] [--json]\n' +
  '  relay show <id> [--json]\n' +
  '  relay update <id> [--state S] [--expect-state S] [--assignee X] [--watcher X] [--note ..] [--title ..] [--desc ..] [--plan ..]\n' +
  '  relay update <id> [--reviewed|--clear-reviewed] [--tested|--clear-tested]   (human checkpoints; reviewed tasks need --tested for merged)\n' +
  '  relay claim <id> [--assignee X] [--force] [--watch]   (--force overrides existing claim; --watch also sets you as watcher)\n' +
  '  relay comment <id> "<message>"   (leave a note on the thread, no state change)\n' +
  '  relay watch <id> [--state S] [--timeout sec] [--continuous]   (block until it changes; --continuous emits an ndjson stream)\n' +
  '  relay watch --set <id>   (register RELAY_ACTOR as watcher without blocking)\n' +
  '  relay watch --state review [--project P|--all]  (block until a task enters that queue)\n' +
  '  relay link <id> --pr owner/repo#123   (link a GitHub PR; needs gh)\n' +
  '  relay sync <id>   ·   relay watch <id> --remote   (pull PR status onto the task)\n' +
  '  relay escalate <id> --note "<what you need>"   (flag: needs a human)\n' +
  '  relay resolve <id> [--note ..]                 (clear the needs-human flag)\n' +
  '  relay ui [<id>] [--me <name>] [--port N]   (local web UI; <id> opens straight to that task)\n' +
  '  relay config set name "<you>"   (your operator identity; fixes "unknown")\n' +
  '  relay register [--project P] [--json]   (generate a unique session name; prints export RELAY_ACTOR=...)\n' +
  '  relay agents [--project P|--all] [--json]   (list registered agents + status)\n' +
  '  relay mcp   (stdio MCP server over the same store)\n' +
  '  relay upgrade   ·   relay --version\n' +
  '  relay completion <bash|zsh|fish> [--install]   (print, or write, a shell completion script)\n\n' +
  `States: ${STATES.join(' → ')} (review = needs QA)\n` +
  'Labels: --label a,b on add/update replaces; --add-label / --rm-label adjust; list --label x filters.\n' +
  'Human inbox: relay list --needs-human   (also --mine for your assigned tasks)\n' +
  'Send-backs (a backward move or blocked) require --note.\n' +
  "Actor: --actor or $RELAY_ACTOR (default 'unknown'). Use -- to end option parsing.\n"

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (['--version', '-v', 'version'].includes(args.command)) {
    process.stdout.write(VERSION + '\n')
    process.exit(0)
  }
  if (args.flags.help || args.command === 'help') {
    process.stdout.write(HELP)
    process.exit(0)
  }
  maybeNudge(args.command, !!args.flags.json)
  // Renew last_seen for any registered agent on every command (best-effort).
  if (args.command !== 'register' && args.command !== 'agents') {
    const actor = resolveActor(val(args.flags.actor))
    try {
      new AgentRegistry().renew(actor)
    } catch {
      // Not a registered agent — that's fine.
    }
  }
  switch (args.command) {
    case 'upgrade':
      return upgradeCommand()
    case 'add':
      return addCommand(args)
    case 'escalate':
      return escalateCommand(args)
    case 'resolve':
      return resolveCommand(args)
    case 'list':
    case 'ls':
      return listCommand(args)
    case 'show':
      return showCommand(args)
    case 'update':
      return updateCommand(args)
    case 'claim':
      return claimCommand(args)
    case 'comment':
      return commentCommand(args)
    case 'link':
      return linkCommand(args)
    case 'sync':
      return syncCommand(args)
    case 'watch':
      return watchCommand(args)
    case 'register':
      return registerCommand(args)
    case 'agents':
      return agentsCommand(args)
    case 'completion':
      return completionCommand(args)
    case 'config':
      return configCommand(args)
    case 'mcp':
      return mcpCommand()
    case 'ui':
      return uiCommand(args)
    default:
      process.stderr.write(HELP)
      process.exit(args.command ? 2 : 0)
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
