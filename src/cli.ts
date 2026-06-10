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
import { detectProject, gitContext, openBrowser, resolveActor } from './util.js'
import { operatorName, readConfig, writeConfig } from './config.js'
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
  process.stdout.write(
    `${task.id}  [${task.state}]${flag}  ${task.title}\n` +
      `  project: ${task.project}   assignee: ${task.assignee ?? '—'}   updated: ${short(task.updatedAt)}${where}${labels}\n`
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
      labels:
        args.flags.label !== undefined ? csv(val(args.flags.label)) : undefined,
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
  if (!id) die('usage: relay claim <id> [--assignee ..]', 2)
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
    die('usage: relay escalate <id> --note "<what you need from a human>"', 2)
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
  if (!id) die('usage: relay resolve <id> [--note ..]', 2)
  const task = await new SqliteTaskStore()
    .resolve(id, {
      actor: resolveActor(val(args.flags.actor)),
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
  const task = await new SqliteTaskStore()
    .comment(id, { actor: resolveActor(val(args.flags.actor)), note })
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

// Block until a task changes, then return. Run with run_in_background so the
// agent is woken on the change. Exit 0 on change, 3 on timeout, 2 on bad args.
async function watchCommand(args: ParsedArgs): Promise<void> {
  const store = new SqliteTaskStore()
  const json = !!args.flags.json
  const [id] = args.positional
  const interval = Math.max(
    0.2,
    args.flags.interval ? parseFloat(val(args.flags.interval)!) : 2
  )
  const timeout = args.flags.timeout
    ? parseFloat(val(args.flags.timeout)!)
    : 600
  const deadline = timeout > 0 ? Date.now() + timeout * 1000 : Infinity

  if (id) {
    // Follow one task until its next change (optionally only when it reaches --state).
    const until = requireState(val(args.flags.state))
    const remote = !!args.flags.remote
    const actor = resolveActor(val(args.flags.actor))
    const start = await store.get(id).catch((e: Error) => die(e.message))
    if (!start) die(`Task "${id}" not found.`, 2)
    const baseline = val(args.flags.since) ?? start.updatedAt
    for (;;) {
      if (remote) {
        const t = await store.get(id)
        for (const link of t?.links ?? []) {
          const changed = await syncLink(store, id, link, actor)
          if (changed) {
            printChange(changed, json)
            return
          }
        }
      }
      const task = await store.get(id)
      if (
        task &&
        task.updatedAt > baseline &&
        (!until || task.state === until)
      ) {
        printChange(task, json)
        return
      }
      if (Date.now() >= deadline)
        die(`Timed out after ${timeout}s with no change to ${id}.`, 3)
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
  const mod = await import('./ui-server.js').catch(() => null)
  if (!mod)
    die('UI not built. Run `bun run build` (or `bun run build:ui`) first.')
  const { createUiServer, loadUiHtml } = mod
  const me =
    val(args.flags.me) ?? operatorName() ?? resolveActor(val(args.flags.actor))
  const port = args.flags.port ? parseInt(val(args.flags.port)!, 10) : undefined
  const server = createUiServer(new SqliteTaskStore(), {
    me,
    port,
    html: loadUiHtml(),
  })
  const url = `http://localhost:${server.port}`
  process.stderr.write(`relay UI on ${url}  (you = ${me})\n`)
  openBrowser(url)
}

const HELP =
  'relay — local-first task tracker for multi-agent coordination\n\n' +
  'Commands:\n' +
  '  relay add "<title>" [--desc ..] [--plan ..] [--assignee ..] [--project ..] [--state todo]\n' +
  '  relay list [--state S] [--assignee X] [--project P|--all] [--since ISO] [--json]\n' +
  '  relay show <id> [--json]\n' +
  '  relay update <id> [--state S] [--assignee X] [--note ..] [--title ..] [--desc ..] [--plan ..]\n' +
  '  relay claim <id> [--assignee X]\n' +
  '  relay comment <id> "<message>"   (leave a note on the thread, no state change)\n' +
  '  relay watch <id> [--state S] [--timeout sec]   (block until it changes; run in background)\n' +
  '  relay watch --state review [--project P|--all]  (block until a task enters that queue)\n' +
  '  relay link <id> --pr owner/repo#123   (link a GitHub PR; needs gh)\n' +
  '  relay sync <id>   ·   relay watch <id> --remote   (pull PR status onto the task)\n' +
  '  relay escalate <id> --note "<what you need>"   (flag: needs a human)\n' +
  '  relay resolve <id> [--note ..]                 (clear the needs-human flag)\n' +
  '  relay ui [--me <name>] [--port N]   (local web UI — the human inbox)\n' +
  '  relay config set name "<you>"   (your operator identity; fixes "unknown")\n' +
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
