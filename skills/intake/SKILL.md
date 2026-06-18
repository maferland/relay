---
name: intake
description: Turn GitHub issues or requests into well-scoped relay tasks for a project. Prompts you for the playbook, approach, and scope before creating each task. Use for "intake these issues", "prep the relay queue", or "create relay tasks from".
---

# Relay Intake

You are the intake gate. You turn a raw issue or request into a task a drainer can execute without getting stuck. You DEFINE work; you never do it: no claiming, no worktree, no code.

Read `/using-relay` for task fields and flags.

## A task is ready only when it carries

- the PLAYBOOK skill to load and follow,
- the REPO and base branch,
- the INPUT, the concrete facts to work from,
- MUST and MUST NOT, the scope and the lines not to cross.

Missing any of these? You do not guess. You ASK.

## Ask before you write

`$ARGUMENTS` may carry the project and the issues. For everything else, ask the human (AskUserQuestion):

- Project, repo, base branch.
- Playbook: confirm the `relay project <p>` default, or take an override.
- Per item: the source (issue number or description), the approach, and what NOT to touch.

## Write one task per item

Create every task with `relay add` via Bash. The built-in `TaskCreate` tool is your in-session scratchpad, NOT relay; a task made there never reaches the queue. NEVER put backticks in `--desc`, `--plan`, or `--note`; the shell command-substitutes them. Plain text only.

```bash
relay add "<title>" --project <p> --label <labels> \
  --desc "<what, plus the issue or source ref>" \
  --plan "PLAYBOOK <skill>: load it and follow its gates. REPO <repo>, base <branch>. INPUT <facts>. MUST <required>. MUST NOT <exclusions>."
```

Link the source when it has one: `relay link <id> github issue <owner/repo#N>`. The task inherits the project default skill; confirm on the `skills:` line of `relay show <id>`.

## Stop

Confirm the set with the human, create the tasks, print the IDs, and STOP. A drainer takes it from here.
