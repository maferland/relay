# agent-tasks

Local-first task tracker for coordinating multi-agent work. Agents and the user log tasks, claim
them, hand off for QA via the `review` state, and poll for changes. Single flat global store,
tasks tagged by `project`.

## Commands

```bash
bun install        # install deps
bun test           # run bun:test suite
bun run typecheck  # tsc --noEmit
bun run build      # typecheck → compile standalone `dist/tasks` binary
bun run dev        # watch mode (runs the CLI)
```

## Running

```bash
tasks add "<title>" [--desc] [--assignee] [--project] [--state todo]
tasks list [--state S] [--assignee X] [--project P|--all] [--since ISO] [--json]
tasks show <id> [--json]
tasks update <id> [--state S] [--assignee X] [--note ..] [--title ..] [--desc ..]
tasks claim <id> [--assignee X]
tasks escalate <id> --note "<what you need>"   # flag: needs a human
tasks resolve <id> [--note ..]                 # clear needs-human
tasks list --needs-human   # the human inbox (also --mine)
tasks mcp          # stdio MCP server over the same store
```

## Architecture

- `src/types.ts` — `State` union, `Task`, `TaskEvent`, `TaskChanges`, `requiresNote()`
- `src/util.ts` — id gen, data dir (`$AGENT_TASKS_DIR` / `$XDG_DATA_HOME` / `~/.local/share`), actor, git-project detection
- `src/store.ts` — `SqliteTaskStore` (over `bun:sqlite`) + the pure `buildTask`/`claim` logic; `update`/`claim` run in IMMEDIATE transactions
- `src/cli.ts` — hand-rolled arg parser, subcommand dispatch, table/`--json` output
- `src/mcp.ts` — MCP server mirroring store ops as tools
- `skills/using-agent-tasks/SKILL.md` — agent coordination guidance

## Constraints

- Store: a single SQLite db at `<dataDir>/tasks.db` (WAL). `$AGENT_TASKS_DIR` overrides the dir (tests use it); else `$XDG_DATA_HOME/agent-tasks` or `~/.local/share/agent-tasks`. Durable — never `os.tmpdir()`. `bun:sqlite` is built into the runtime, so the compiled binary has no extra dependency.
- Actor identity: `--actor` flag or `$AGENT_TASKS_ACTOR` (default `unknown`).
- States: `todo → doing → review → done`, plus `blocked`. `review` is the QA-handoff signal.
- **Send-backs require a note**: any backward transition (e.g. `review → todo`) or move to `blocked` is rejected without `--note`. Enforced in `store.update`, so CLI and MCP both honor it.
- `list` defaults to the current git project; `--all` shows every project.
- Concurrency: SQLite serializes writers (IMMEDIATE transaction + `busy_timeout`), so concurrent updates — same process or across agent processes — never drop a history entry. `busy_timeout` is set before the WAL switch so first-time concurrent construction doesn't throw "database is locked".
