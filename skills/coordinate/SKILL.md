---
name: coordinate
description: Run a relay coordinator session — watch for tasks in review, run QA, merge passing PRs, and steer drainers. Use when asked to "coordinate relay", "QA relay tasks", or "start a coordinator".
---

# Relay Coordinator

Read `/using-relay` before starting — it covers task lifecycle, states, flags, and the watcher field.
Read `/cli:using-gh` for merging PRs.
Read `/cli:using-playwright` for UI verification.

## Before you start

$ARGUMENTS may contain the project name (e.g. `/relay:coordinate relay`).
If it's empty, ask which project to coordinate.

## Identity

```bash
export RELAY_ACTOR=coordinator-<something-unique>
relay register --project <project>
```

## Core loop

Your turn-by-turn loop IS the watch loop. At the top of every turn:

```bash
relay watch --state review --project <project> --json --timeout 60
```

- Task arrives → QA it (steps 1–6), then start next turn the same way.
- Timeout → start next turn immediately. Do not wait to be prompted.

### 1. Read the handoff

```bash
relay show <id>
```

### 2. Set up a verify worktree

```bash
git fetch origin
git worktree add .worktrees/verify-<id> origin/<branch>
```

### 3. Automated checks

```bash
cd .worktrees/verify-<id>
bun install
bun run typecheck && bun test && bun run lint && bun run format:check
```

Any failure → send back (update the existing task, never create a new one):
```bash
relay update <id> --state todo --note "<exact failure and what to fix>"
```

### 4. Real-world testing

Don't stop at "tests pass."

- **CLI changes**: run the binary against a temp store; verify correct output, not just no-crash.
- **UI changes**: `bun run build:ui`, start `relay ui` on a free port, drive with Playwright. Use `/pinpoint:review` for layout/UX — don't approve subjective UI changes unverified.
- **Store/model changes**: create → mutate → verify the stored shape in a temp dir.
- **Docs/skill changes**: read the diff as if following it as an agent. Does the guidance match the code?

### 5. Code review

- Does it do exactly what the task asked? No more, no less.
- Bugs, edge cases, regressions?
- Style consistent with surrounding code?
- Do new tests actually break when the code is wrong?

### 6. Merge

```bash
gh pr merge <n> --squash
relay update <id> --state merged --tested --note "Merged PR #N"
git worktree remove .worktrees/verify-<id> --force
```

### 7. Steer

```bash
relay list --project <project> --state todo
```

- Clear next tasks → comment on the best one so drainers know what to pick up.
- Task keeps bouncing → rewrite the note with more specific instructions. Always update the existing task; never create a new one for the same work.
- Design decision needed → `relay escalate <id> --note "<question>"`
- Drainer gone quiet (>10 min in `doing`) → `relay agents`

When in doubt — merge vs send-back, scope, design — stop and ask the user.
