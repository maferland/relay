---
name: drain
description: Run a relay drainer session — claim todo tasks, implement them, push a branch, open a PR, and hand off for coordinator review. Use when asked to "drain the relay queue", "work on relay tasks", or "start a drainer".
---

# Relay Drainer

You are a relay DRAINER. You take one task from the queue and drive it to `merged`, then take the next. You implement; you never review, judge, or merge.

Load `/cli:using-gh` (branches, PRs). For the full task model and examples, see `/using-relay` if it's installed; everything you must follow is inlined below regardless.

## Identity

`$ARGUMENTS` may name the project. If not, ask which project to drain, and whether to prioritize specific task IDs.

```bash
export RELAY_ACTOR=drainer-<something-unique>
relay register --project <project>
/rename drainer [<project>]
```

## relay is a CLI — never MCP, never the built-in Task tools

The relay queue lives ONLY behind the `relay` CLI, run via Bash: read with `relay list`/`relay show`, write with `relay add`/`relay update`/`relay claim`. There is no MCP `watch_task`/`list_tasks`. The built-in `TaskList`/`TaskCreate` tools are your in-session scratchpad, NOT relay; never read or write the queue with them. Never substitute a `sleep` loop for `relay watch`.

## The loop

One task at a time, to `merged`, then repeat. Stop only when the queue is empty or a blocker is unresolvable.

### 1. Pick

```bash
relay list --project <project> --state todo
```

Prefer `bug` over features. Skip anything in `doing`. Nothing there? Wait 30s, retry 3x, then stop.

### 2. Claim

```bash
RELAY_ACTOR=$RELAY_ACTOR relay claim <id>
relay show <id>   # confirm project + assignee are yours
/rename drainer [<id>]
```

Not yours (wrong project or assignee)? Release it: `relay update <id> --state todo --assignee ""`.

### 3. Worktree off the repo's default branch

The task plan names the repo and base branch (carta-web is `master`, not `main`). NEVER assume `main` — confirm with `git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD`.

```bash
git -C <repo> worktree add .worktrees/<slug> -b <branch> origin/<default-branch>
```

Work ONLY there. Keep it alive until `merged`.

### 4. Implement

Read `CLAUDE.md` first. The task names a PLAYBOOK skill (the `skills:` line of `relay show <id>`) — load it and follow it exactly, gates included. NEVER improvise the methodology a playbook owns; if it isn't installed here, stop: `relay update <id> --state blocked --note "playbook <skill> unavailable in this session"`. Do exactly what the task says, no more.

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

All green before you hand off.

### 6. Re-check before pushing

```bash
relay show <id>
```

No longer `doing`? It was sent back. Abandon without pushing, then loop:

```bash
git -C <repo> worktree remove .worktrees/<slug> --force
```

### 7. Commit + push

One conventional commit, no em-dashes.

```bash
git push -u origin <branch>
gh pr create --base main --head <branch> --title "..." --body "..."
```

Do NOT merge.

### 8. Hand off and stay on the watch — ONE backgrounded command

`--follow` moves the task to `review` then blocks on the watch, so the loop can't be dropped. Wait forever (`--timeout 0`), run it with `run_in_background: true`, and the harness wakes you on the verdict. A finite timeout only reopens the gap where you forget to re-arm.

```bash
relay update <id> --state review --follow --json --timeout 0 \
  --note "<what changed + how to verify, including manual/UI steps>"
```

React to what it returns:

- `merged` → remove the worktree, back to step 1: `git -C <repo> worktree remove .worktrees/<slug> --force`
- `todo` + note → stay in the worktree, fix, back to step 5, force-push, hand off again

## Never

- Work a task outside your registered project.
- Make a design call. Ambiguous? `relay update <id> --state blocked --note "Unclear: <question>. Needs coordinator decision."`
