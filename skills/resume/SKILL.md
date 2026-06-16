---
name: resume
description: Resume a relay drainer session that was stopped mid-task. Use when a drainer was killed, crashed, or timed out and needs to pick up where it left off on an in-progress task.
---

# Relay Resume

Use this when a drainer session was interrupted and a task is stuck in `doing`.

Read `/using-relay` to understand task states before continuing.

## Before you start

$ARGUMENTS may contain the project name. If not, ask:

1. Which project were you draining?
2. Do you know the task ID, or should we find stuck tasks?

Set your identity to match the original session if you know it, or use a new one:

```bash
export RELAY_ACTOR=drainer-<something-unique>
```

## Find the stuck task

```bash
relay list --project <project> --state doing
```

If you know the ID:

```bash
relay show <id>
```

## Diagnose where you left off

Check what exists for this task:

```bash
# Is a worktree still around?
ls <repo>/.worktrees/

# Was the branch pushed?
git ls-remote origin <branch>

# Is there already a PR?
gh pr list --head <branch>
```

## Pick up from the right step

**Worktree exists, branch not pushed:**
The implementation may be partial. Check what's there, complete it, then run verify (step 5 of the drain loop).

**Worktree exists, branch pushed, no PR:**
Verify passes? Open the PR:

```bash
gh pr create --base main --head <branch> --title "..." --body "..."
```

Then hand off:

```bash
relay update <id> --state review --note "<what changed + how to verify>"
relay watch <id> --json --timeout 300
```

**Worktree exists, PR already open:**
The agent was stopped after opening the PR but before handing off. Hand off now:

```bash
relay update <id> --state review --note "<what changed + how to verify>"
relay watch <id> --json --timeout 300
```

**No worktree, branch pushed:**
Recreate the worktree from the existing branch:

```bash
git -C <repo> fetch origin
git -C <repo> worktree add .worktrees/<slug> <branch>
```

Then verify from inside it (step 5 of the drain loop). Force-push after any fixes.

**No worktree, branch not pushed, task still doing:**
The work was lost. Re-implement from scratch:

```bash
git -C <repo> worktree add .worktrees/<slug> -b <branch> origin/main
```

Then follow the drain loop from step 4.

**Task state is `todo` (not `doing`):**
The coordinator already reset it. Treat as a fresh task — follow the normal drain loop from step 1.

**Task state is `review`:**
You already handed off. Just re-arm the watch:

```bash
relay watch <id> --json --timeout 300
```

## After recovering

Once you've re-established where you are, continue with the normal drain loop. Do not create a new task — always continue with the existing `<id>`.
