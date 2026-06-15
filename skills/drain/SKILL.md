---
name: drain
description: Run a relay drainer session — claim todo tasks, implement them, push a branch, open a PR, and hand off for coordinator review. Use when asked to "drain the relay queue", "work on relay tasks", or "start a drainer".
---

# Relay Drainer

Read `/using-relay` before starting — it covers task lifecycle, states, flags, and the claim guard.
Read `/cli:using-gh` for pushing branches and opening PRs.

## Before you start

$ARGUMENTS may contain the project name (e.g. `/relay:drain relay`).
If it's empty, ask:

1. Which project to drain? (required)
2. Any specific task IDs to prioritize, or just take the queue in order?

## Identity

```bash
export RELAY_ACTOR=drainer-<something-unique>
relay register --project <project>
/rename drainer [<project>]
```

## Loop

Repeat until the queue is empty or you hit an unresolvable error.

### 1. Pick a task

```bash
relay list --project <project> --state todo
```

Prefer `bug` labels over features. Skip tasks already in `doing`.
If nothing available: wait 30s, retry up to 3 times, then stop.

### 2. Claim it

```bash
RELAY_ACTOR=$RELAY_ACTOR relay claim <id>
relay show <id>   # verify project and assignee match
/rename drainer [<id>]
```

If project is wrong or assignee isn't you:

```bash
relay update <id> --state todo --assignee ""
```

### 3. Worktree off latest main

```bash
git -C <repo> worktree add .worktrees/<slug> -b <branch> origin/main
```

Work ONLY in that worktree. Keep it alive until the task reaches `merged`.

### 4. Implement

Read `CLAUDE.md` first. Do exactly what the task says — no more, no less.

### 5. Verify

```bash
bun install
bun run typecheck
bun test
bun run lint
bunx prettier --write <changed files>
bun run format:check
bun run build:ui   # only if UI files changed
```

All must pass before handing off.

### 6. Check for concurrent send-backs

```bash
relay show <id>
```

If state is no longer `doing`, abandon without pushing:

```bash
git -C <repo> worktree remove .worktrees/<slug> --force
```

Then loop to step 1.

### 7. Commit and push

One conventional commit per task. No em-dashes.

```bash
git push -u origin <branch>
gh pr create --base main --head <branch> --title "..." --body "..."
```

Do NOT merge.

### 8. Hand off and wait

```bash
relay update <id> --state review \
  --note "<what changed + how to verify, including manual/UI steps>"
```

Then watch for the coordinator:

```bash
relay watch <id> --json --timeout 300
```

- `state: merged` → remove worktree, loop to step 1
  ```bash
  git -C <repo> worktree remove .worktrees/<slug> --force
  ```
- `state: todo` with a note → stay in the worktree, fix the issue, go back to step 5, force-push
- Timeout → run watch again; do not abandon in-flight tasks

## Rules

- Only work on tasks from your registered project.
- Never make design decisions. If ambiguous:
  ```bash
  relay update <id> --state blocked \
    --note "Unclear: <question>. Needs coordinator decision."
  ```
