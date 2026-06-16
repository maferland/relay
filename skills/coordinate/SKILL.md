---
name: coordinate
description: Run a relay coordinator session — watch for tasks in review, run QA, get human sign-off, then merge. Use when asked to "coordinate relay", "QA relay tasks", or "start a coordinator".
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
/rename coordinator [<project>]
```

## Core loop

Your turn-by-turn loop IS the watch loop. At the top of every turn:

```bash
relay watch --project <project> --json --timeout 60
```

Watch the whole project, not just one state. Route on what arrives:

- `state: review` → QA it (steps 1–6 below)
- `state: ready` → a task you already passed is waiting for human sign-off; remind the human if they haven't acted
- `state: merged` → confirm the task is marked correctly; if a PR was merged externally without going through you, update the task
- `state: todo` with a note → a send-back you triggered; no action needed, the drainer will pick it up
- `state: blocked` → escalate to the human
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

### 4. Real-world testing (MANDATORY — no exceptions)

**Automated tests passing is not enough. You must use the feature as a human operator would.**

Ask yourself: "If I handed this to a user right now, would it work?" Then go find out. Boot the actual binary or the running UI. Walk through the feature. Try the edge cases. Break it if you can.

- **CLI changes**: build the binary (`bun run build`), run it against a temp store seeded with realistic data. Execute the changed commands. Read the output. Is it correct? Does it handle bad input gracefully? Does anything adjacent regress?
- **UI changes**: `bun run build:ui`, start `relay ui` on a free port against a seeded temp store, open it in a browser, click through the changed flow. Use `/pinpoint:review` for anything visual — do not eyeball layout in your head. Drive it with Playwright for interactions.
- **Store/model changes**: open a temp dir, run the CLI through a full create → mutate → read cycle, inspect the stored state directly. Does the shape match what the code claims?
- **Docs/skill changes**: follow the instructions yourself, step by step, as if you are a fresh agent reading them for the first time. Does every command work? Does the guidance match the current code behavior exactly?

If you cannot complete live testing for any reason, send the task back with a clear note on what was untestable. Do not move to code review without live testing done.

### 5. Code review

- Does it do exactly what the task asked? No more, no less.
- Bugs, edge cases, regressions?
- Style consistent with surrounding code?
- Do new tests actually break when the code is wrong?

### 6. Hand off to human (you are now blocked)

Once automated checks, live testing, and code review all pass, mark the task ready and stop. You cannot merge without human sign-off.

```bash
relay update <id> --state ready --reviewed \
  --note "QA passed. Verified: <what you tested and how>. PR #N ready to merge."
```

Then tell your human **loudly and clearly**:

> **Blocked — waiting for your review.**
> Task `<id>` passed all checks. PR #N is ready to merge.
> Here is what I verified: <brief summary>.
> **Please review the PR and tell me to merge, or send it back with feedback.**

Do not continue the watch loop. Do not merge on your own. Wait for the human's explicit go-ahead before proceeding to step 7.

### 7. Merge (only after explicit human approval)

When the human says to merge:

```bash
gh pr merge <n> --squash
relay update <id> --state merged --tested --note "Merged PR #N"
git worktree remove .worktrees/verify-<id> --force
```

Then resume the watch loop.

### 8. Steer

```bash
relay list --project <project> --state todo
```

- Clear next tasks → comment on the best one so drainers know what to pick up.
- Task keeps bouncing → rewrite the note with more specific instructions. Always update the existing task; never create a new one for the same work.
- Design decision needed → `relay escalate <id> --note "<question>"`
- Drainer gone quiet (>10 min in `doing`) → `relay agents`

When in doubt — merge vs send-back, scope, design — stop and ask the user.
