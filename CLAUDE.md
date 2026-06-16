# relay

Local-first task tracker for coordinating multi-agent work. Agents and the user log tasks, claim
them, hand off for QA via the `review` state, and poll for changes. Single flat global store,
tasks tagged by `project`.

## Commands

```bash
bun install        # install deps
bun test           # run bun:test suite
bun run typecheck  # tsc --noEmit
bun run build      # typecheck → compile standalone `dist/relay` binary
bun run dev        # watch mode (runs the CLI)
bun run build:ui   # build just the SPA → dist/ui/index.html
bun run dev:ui      # vite dev server for the UI (needs `relay ui` running for the API)
verdict run        # LLM behavior tests for the using-relay skill (needs 1Password unlocked)
```

## Running

```bash
relay add "<title>" [--desc] [--assignee] [--project] [--state todo]
relay list [--state S] [--assignee X] [--project P|--all] [--since ISO] [--json]
relay show <id> [--json]
relay update <id> [--state S] [--assignee X] [--note ..] [--title ..] [--desc ..]
relay claim <id> [--assignee X]
relay escalate <id> --note "<what you need>"   # flag: needs a human
relay resolve <id> [--note ..]                 # clear needs-human
relay list --needs-human   # the human inbox (also --mine)
relay ui [--me <name>] [--port N]   # local web UI (the human inbox); opens browser
relay mcp          # stdio MCP server over the same store
```

## Architecture

- `src/types.ts` — `State` union, `Task`, `TaskEvent`, `TaskChanges`, `requiresNote()`
- `src/util.ts` — id gen, data dir (`$RELAY_DIR` / `$XDG_DATA_HOME` / `~/.local/share`), actor, git-project detection
- `src/store.ts` — `SqliteTaskStore` (over `bun:sqlite`) + the pure `buildTask`/`claim` logic; `update`/`claim` run in IMMEDIATE transactions
- `src/cli.ts` — hand-rolled arg parser, subcommand dispatch, table/`--json` output
- `src/mcp.ts` — MCP server mirroring store ops as tools
- `src/ui-server.ts` — `relay ui` HTTP server: REST over the store + `/api/changes` long-poll + serves the SPA; adapts store tasks to the UI shape (ISO→epoch ms, derives actors, the human = `--me`/`$RELAY_ACTOR`)
- `ui/` — Vite + React SPA (the Needs-you inbox, etc.). Built to a single `dist/ui/index.html` via `vite-plugin-singlefile`. Tokens/CSS are from the design handoff (`ui/styles/`), treated as final
- `skills/using-relay/SKILL.md` — agent coordination guidance

## Constraints

- Store: a single SQLite db at `<dataDir>/tasks.db` (WAL). `$RELAY_DIR` overrides the dir (tests use it); else `$XDG_DATA_HOME/relay` or `~/.local/share/relay`. Durable — never `os.tmpdir()`. `bun:sqlite` is built into the runtime, so the compiled binary has no extra dependency.
- Actor identity: `--actor` flag or `$RELAY_ACTOR` (default `unknown`).
- States: `todo → doing → review → ready → merged`, plus `blocked`. `review` is the QA-handoff signal; `ready` means QA passed and it is waiting on the human's review and merge; `merged` is terminal.
- **Send-backs require a note**: any backward transition (e.g. `review → todo`) or move to `blocked` is rejected without `--note`. Enforced in `store.update`, so CLI and MCP both honor it.
- `list` defaults to the current git project; `--all` shows every project.
- UI: all three screens are live — Needs-you inbox (escalated/blocked/review/mine), Board (list + Kanban with drag-to-move and the click-to-move menu), and Task detail (history timeline + side rail). Note-modal transitions, toasts, theme, and the `/api/changes` long-poll all work. The SPA is embedded into the compiled binary (`ui-server.ts` text-imports `dist/ui/index.html`; `bun run build` builds the UI before compiling), so `relay ui` runs standalone.
- Concurrency: SQLite serializes writers (IMMEDIATE transaction + `busy_timeout`), so concurrent updates — same process or across agent processes — never drop a history entry. `busy_timeout` is set before the WAL switch so first-time concurrent construction doesn't throw "database is locked".
