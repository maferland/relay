---
name: using-relay
description: Use when coordinating work across multiple agents (or with the user) through a shared, persistent task list — logging tasks for another agent, claiming work, handing off for QA, polling for state changes, or QA'ing and sending work back. Triggers on "log a task", "assign this to an agent", "what's waiting for QA", "pick up a task", "review the queue", or any multi-agent handoff.
---

# Coordinating work with `relay`

`relay` is a local, persistent task tracker shared across all your sessions and worktrees. Use it
to hand work between agents asynchronously: one actor logs a task, another claims and does it,
then hands it off for QA, and a coordinator (you or the user) checks the result.

Unlike in-session subagents, these tasks survive across sessions — an agent in another window or
a later run sees the same list.

## Identity

Set who you are once per session so your changes are attributable:

```bash
export RELAY_ACTOR=worker-1   # or: lead, qa, reviewer, your name…
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
relay add "Fix the login redirect loop" --assignee worker-1 \
  --desc "Repro: log in from /cart" \
  --plan "1. reproduce 2. patch auth/redirect.ts 3. add a test"
```

Prints the new task (with its `id`). Defaults to the current git repo as the `project` and
`todo` as the state. Use `--desc` for _what_ is being done and `--plan` for _how_. If a title
contains a leading dash, put it after a `--` sentinel: `relay add -- --weird title`.

### Picking up and doing work

```bash
relay list --state todo --assignee worker-1   # what's assigned to me
relay claim task-1a2b3c4d                      # → doing, assigned to me
# …do the work…
relay update task-1a2b3c4d --state review --note "Fixed; ready for QA. Touched auth/redirect.ts"
```

`claim` records **where** you are working: it auto-stamps the current git `branch` and
`worktree` onto the task (run it from the worktree where you'll do the work). A coordinator then
knows exactly where to look. `claim` only picks up open work — a task already in `review` or
`done` must be reopened deliberately with `update --state doing --note "<why>"`, not claimed.

### Coordinating / QA

Poll for work waiting on QA, then QA it:

```bash
relay list --state review                      # the handoff queue (current project)
relay list --state review --all                # across every project
relay show task-1a2b3c4d                        # full detail + history exchange
```

- **Pass QA:** `relay update task-1a2b3c4d --state done --note "QA passed"`
- **Reject (send back):** `relay update task-1a2b3c4d --state todo --note "Login works but logout 500s — see step 3"`

You can also QA by delegating: spawn a subagent whose job is to verify a task in `review` and
either move it to `done` or send it back with findings.

## Escalating to a human

When something genuinely needs a person — a credential, an approval, a judgement call — flag it,
in whatever state the task is in:

```bash
relay escalate task-1a2b3c4d --note "Need staging DB creds to reproduce the flake"
```

This sets a `needsHuman` flag (separate from state — a task can be `doing` and still need a human).
The human inbox is then one query:

```bash
relay list --needs-human          # everything waiting on a person, across states
relay list --mine                 # tasks assigned to you ($RELAY_ACTOR)
```

Once the human has handled it, clear the flag: `relay resolve task-1a2b3c4d --note "creds granted"`.
Prefer `escalate` over parking a task in `blocked` when the blocker is specifically a human — it
stays findable regardless of state and doesn't conflate "blocked on another task" with "needs me".

## Notes are required on send-backs

Moving a task **backward** (e.g. `review → todo`, `review → doing`, reopening `done`) or to
`blocked` **requires `--note`**. The command fails without one. This is on purpose: the next
actor needs to know _why_ it came back. Forward moves don't need a note (but a short one helps).

The back-and-forth lives in `relay show <id>` under `history` — every transition records who,
when, the state change, and the note. That is the conversation between the worker and QA.

To add to that conversation **without** a state change — a question, context, an answer — use
`relay comment <id> "<message>"`. It appends a note-only entry to the same thread:

```bash
relay comment task-1a2b3c4d "what did you mean by 'the redirect case'?"
```

## Labels (orthogonal to state)

State tracks _where_ a task is in the flow. Labels track _anything else_ — free-form tags you
attach on top of the state. Reach for them to add review granularity without inventing new states:

- `awaiting-code-review`, `awaiting-human` — waiting on a specific kind of review
- `code-reviewed` — a gate that has passed

```bash
relay add "fix auth" --label awaiting-code-review,backend     # set at creation (replaces the set)
relay update task-1a2b3c4d --add-label code-reviewed --rm-label awaiting-code-review
relay list --label code-reviewed                              # filter (must carry every --label)
```

`--label` replaces the whole set; `--add-label` / `--rm-label` adjust it without clobbering.

## Reacting to changes

Two ways, depending on whether you want to keep working while you wait.

**Wait for a handoff — `relay watch` (blocking).** Run it as a background task: you fire it,
carry on with other work, and the harness wakes you when it returns. It returns on the first
change (exit 0), or on timeout (exit 3).

```bash
relay watch task-1a2b3c4d --json                 # follow one task until it next changes
relay watch task-1a2b3c4d --state review --json  # …until it reaches review (the QA handoff)
relay watch --state review --project myrepo       # until any task enters the review queue
```

Run it with `run_in_background: true` (never `&`/`nohup` — a detached process can't wake you).
Defaults: polls every 2s, gives up after 600s; pass `--timeout 0` to wait indefinitely or
`--since <ISO>` to set the baseline you're comparing against.

**Periodic check-in — `relay list --since` (polling).** For a coordinator that sweeps on its own
cadence, or any agent working purely through MCP (where blocking isn't an option):

```bash
relay list --state review --since 2026-06-08T14:00:00Z --json
```

`--since` keeps only tasks updated at/after an ISO timestamp, so you see "what moved since I last
looked". Use `--json` for machine-readable output.

## When to log a task vs. just doing it

- **Just do it** if it's part of your current turn and no handoff is needed.
- **Log a task** when another agent (or the user, or a future session) should pick it up, when
  you need a QA gate before something counts as done, or when you're a coordinator parcelling out
  parallel work.

## Command reference

| Command                                                                         | Purpose                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `relay add "<title>" [--desc] [--plan] [--assignee] [--project] [--state]`      | log a task                                             |
| `relay list [--state] [--assignee] [--project\|--all] [--since] [--json]`       | filtered list                                          |
| `relay show <id> [--json]`                                                      | one task + full history                                |
| `relay update <id> [--state] [--assignee] [--note] [--title] [--desc] [--plan]` | change + record note                                   |
| `relay claim <id> [--assignee]`                                                 | assign to self, move to `doing`, stamp branch/worktree |
| `relay comment <id> "<message>"`                                                | add a note to the thread, no state change              |
| `relay watch <id> [--state] [--timeout] [--json]`                               | block until a task changes (run in background)         |
| `relay escalate <id> --note "<what you need>"`                                  | flag as needing a human                                |
| `relay resolve <id> [--note]`                                                   | clear the needs-human flag                             |

Pass an empty string (`--assignee ""`) to clear a field. Identity comes from `--actor` or
`$RELAY_ACTOR`.

Same operations are available as MCP tools (`add_task`, `list_tasks`, `get_task`, `update_task`,
`claim_task`, `comment_task`, `escalate_task`, `resolve_task`) for non-interactive scripting.
