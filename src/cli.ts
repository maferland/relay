import { buildTask, SqliteTaskStore } from './store.js'
import {
  isState,
  STATES,
  type State,
  type Task,
  type TaskChanges,
} from './types.js'
import { detectProject, gitContext, openBrowser, resolveActor } from './util.js'

const BOOL_FLAGS = new Set(['all', 'json', 'needs-human', 'mine', 'help'])
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
])

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
  process.stdout.write(
    `${task.id}  [${task.state}]${flag}  ${task.title}\n` +
      `  project: ${task.project}   assignee: ${task.assignee ?? '—'}   updated: ${short(task.updatedAt)}${where}\n`
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
      'usage: tasks add "<title>" [--desc ..] [--plan ..] [--assignee ..] [--project ..] [--state todo]',
      2
    )
  }
  const actor = resolveActor(val(args.flags.actor))
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
      actor,
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
  })
  printList(tasks, !!args.flags.json, scope)
}

async function showCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id) die('usage: tasks show <id>', 2)
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
    die('usage: tasks update <id> [--state ..] [--assignee ..] [--note ..]', 2)
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

  const task = await new SqliteTaskStore()
    .update(id, changes, {
      actor: resolveActor(val(args.flags.actor)),
      note: val(args.flags.note),
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function claimCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id) die('usage: tasks claim <id> [--assignee ..]', 2)
  const actor = resolveActor(val(args.flags.actor))
  const git = gitContext()
  const task = await new SqliteTaskStore()
    .claim(id, {
      assignee: val(args.flags.assignee) ?? actor,
      actor,
      note: val(args.flags.note),
      branch: val(args.flags.branch) ?? git.branch,
      worktree: val(args.flags.worktree) ?? git.worktree,
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function escalateCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id)
    die('usage: tasks escalate <id> --note "<what you need from a human>"', 2)
  const task = await new SqliteTaskStore()
    .escalate(id, {
      actor: resolveActor(val(args.flags.actor)),
      note: val(args.flags.note),
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function resolveCommand(args: ParsedArgs): Promise<void> {
  const [id] = args.positional
  if (!id) die('usage: tasks resolve <id> [--note ..]', 2)
  const task = await new SqliteTaskStore()
    .resolve(id, {
      actor: resolveActor(val(args.flags.actor)),
      note: val(args.flags.note),
    })
    .catch((e: Error) => die(e.message))
  printTask(task, !!args.flags.json)
}

async function mcpCommand(): Promise<void> {
  const { StdioServerTransport } =
    await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { createServer } = await import('./mcp.js')
  await createServer(new SqliteTaskStore()).connect(new StdioServerTransport())
}

async function uiCommand(args: ParsedArgs): Promise<void> {
  const mod = await import('./ui-server.js').catch(() => null)
  if (!mod)
    die('UI not built. Run `bun run build` (or `bun run build:ui`) first.')
  const { createUiServer, loadUiHtml } = mod
  const me = val(args.flags.me) ?? resolveActor(val(args.flags.actor))
  const port = args.flags.port ? parseInt(val(args.flags.port)!, 10) : undefined
  const server = createUiServer(new SqliteTaskStore(), {
    me,
    port,
    html: loadUiHtml(),
  })
  const url = `http://localhost:${server.port}`
  process.stderr.write(`agent-tasks UI on ${url}  (you = ${me})\n`)
  openBrowser(url)
}

const HELP =
  'tasks — local-first task tracker for multi-agent coordination\n\n' +
  'Commands:\n' +
  '  tasks add "<title>" [--desc ..] [--plan ..] [--assignee ..] [--project ..] [--state todo]\n' +
  '  tasks list [--state S] [--assignee X] [--project P|--all] [--since ISO] [--json]\n' +
  '  tasks show <id> [--json]\n' +
  '  tasks update <id> [--state S] [--assignee X] [--note ..] [--title ..] [--desc ..] [--plan ..]\n' +
  '  tasks claim <id> [--assignee X]\n' +
  '  tasks escalate <id> --note "<what you need>"   (flag: needs a human)\n' +
  '  tasks resolve <id> [--note ..]                 (clear the needs-human flag)\n' +
  '  tasks ui [--me <name>] [--port N]   (local web UI — the human inbox)\n' +
  '  tasks mcp   (stdio MCP server over the same store)\n\n' +
  `States: ${STATES.join(' → ')} (review = needs QA)\n` +
  'Human inbox: tasks list --needs-human   (also --mine for your assigned tasks)\n' +
  'Send-backs (a backward move or blocked) require --note.\n' +
  "Actor: --actor or $AGENT_TASKS_ACTOR (default 'unknown'). Use -- to end option parsing.\n"

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.flags.help || args.command === 'help') {
    process.stdout.write(HELP)
    process.exit(0)
  }
  switch (args.command) {
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
