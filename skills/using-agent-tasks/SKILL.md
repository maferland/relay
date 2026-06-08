---
name: using-agent-tasks
description: Use when coordinating work across multiple agents (or with the user) through a shared, persistent task list — logging tasks for another agent, claiming work, handing off for QA, polling for state changes, or QA'ing and sending work back. Triggers on "log a task", "assign this to an agent", "what's waiting for QA", "pick up a task", "review the queue", or any multi-agent handoff.
---

# Coordinating work with `agent-tasks`

`tasks` is a local, persistent task tracker shared across all your sessions and worktrees. Use it
to hand work between agents asynchronously: one actor logs a task, another claims and does it,
then hands it off for QA, and a coordinator (you or the user) checks the result.

Unlike in-session subagents, these tasks survive across sessions — an agent in another window or
a later run sees the same list.

## Identity

Set who you are once per session so your changes are attributable:

```bash
export AGENT_TASKS_ACTOR=worker-1   # or: lead, qa, reviewer, your name…
```

Every command also takes `--actor <name>` to override per call. Default is `unknown` — set it.

## The workflow

States flow `todo → doing → review → done`, with `blocked` off to the side. **`review` is the
QA-handoff signal.** A coordinator polls for it.

```
todo  ──claim──▶  doing  ──"--state review"──▶  review  ──"--state done"──▶  done
  ▲                                               │
  └────────── "--state todo --note <why>" ◀───────┘   (QA rejects)
```

### Logging a task for someone else

```bash
tasks add "Fix the login redirect loop" --assignee worker-1 \
  --desc "Repro: log in from /cart" \
  --plan "1. reproduce 2. patch auth/redirect.ts 3. add a test"
```

Prints the new task (with its `id`). Defaults to the current git repo as the `project` and
`todo` as the state. Use `--desc` for *what* is being done and `--plan` for *how*. If a title
contains a leading dash, put it after a `--` sentinel: `tasks add -- --weird title`.

### Picking up and doing work

```bash
tasks list --state todo --assignee worker-1   # what's assigned to me
tasks claim task-1a2b3c4d                      # → doing, assigned to me
# …do the work…
tasks update task-1a2b3c4d --state review --note "Fixed; ready for QA. Touched auth/redirect.ts"
```

`claim` records **where** you are working: it auto-stamps the current git `branch` and
`worktree` onto the task (run it from the worktree where you'll do the work). A coordinator then
knows exactly where to look. `claim` only picks up open work — a task already in `review` or
`done` must be reopened deliberately with `update --state doing --note "<why>"`, not claimed.

### Coordinating / QA

Poll for work waiting on QA, then QA it:

```bash
tasks list --state review                      # the handoff queue (current project)
tasks list --state review --all                # across every project
tasks show task-1a2b3c4d                        # full detail + history exchange
```

- **Pass QA:** `tasks update task-1a2b3c4d --state done --note "QA passed"`
- **Reject (send back):** `tasks update task-1a2b3c4d --state todo --note "Login works but logout 500s — see step 3"`

You can also QA by delegating: spawn a subagent whose job is to verify a task in `review` and
either move it to `done` or send it back with findings.

## Notes are required on send-backs

Moving a task **backward** (e.g. `review → todo`, `review → doing`, reopening `done`) or to
`blocked` **requires `--note`**. The command fails without one. This is on purpose: the next
actor needs to know *why* it came back. Forward moves don't need a note (but a short one helps).

The back-and-forth lives in `tasks show <id>` under `history` — every transition records who,
when, the state change, and the note. That is the conversation between the worker and QA.

## Detecting changes (polling)

There is no background watcher. To react to changes, poll with a filter when you check in:

```bash
tasks list --state review --since 2026-06-08T14:00:00Z --json
```

`--since` keeps only tasks updated at/after an ISO timestamp, so a coordinator can find "what
moved since I last looked". Use `--json` for machine-readable output you can parse.

## When to log a task vs. just doing it

- **Just do it** if it's part of your current turn and no handoff is needed.
- **Log a task** when another agent (or the user, or a future session) should pick it up, when
  you need a QA gate before something counts as done, or when you're a coordinator parcelling out
  parallel work.

## Command reference

| Command | Purpose |
|---|---|
| `tasks add "<title>" [--desc] [--plan] [--assignee] [--project] [--state]` | log a task |
| `tasks list [--state] [--assignee] [--project\|--all] [--since] [--json]` | filtered list |
| `tasks show <id> [--json]` | one task + full history |
| `tasks update <id> [--state] [--assignee] [--note] [--title] [--desc] [--plan]` | change + record note |
| `tasks claim <id> [--assignee]` | assign to self, move to `doing`, stamp branch/worktree |

Pass an empty string (`--assignee ""`) to clear a field. Identity comes from `--actor` or
`$AGENT_TASKS_ACTOR`.

Same operations are available as MCP tools (`add_task`, `list_tasks`, `get_task`, `update_task`,
`claim_task`) for non-interactive scripting.
