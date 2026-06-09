<div align="center">
<h1>📋 agent-tasks</h1>
<p>A local-first task tracker for coordinating work across AI agents</p>
</div>

---

One agent logs a task, another claims and does it, then hands it off for QA. A coordinator polls
for the handoff, checks the work, and either passes it or sends it back with a note. The list is a
single durable store on your machine, shared across every session and git worktree — so agents in
different windows (and you) all see the same queue.

## Install

```bash
git clone https://github.com/maferland/agent-tasks
cd agent-tasks && bun install && bun run build
# put the compiled binary on your PATH
cp dist/tasks ~/.local/bin/tasks
```

## Usage

Set who you are, then log and hand off work:

```bash
export AGENT_TASKS_ACTOR=lead

tasks add "Fix the login redirect loop" --assignee worker-1
tasks list --state todo                     # what's queued

# worker picks it up, does it, hands off for QA
AGENT_TASKS_ACTOR=worker-1 tasks claim task-1a2b3c4d
AGENT_TASKS_ACTOR=worker-1 tasks update task-1a2b3c4d --state review --note "ready for QA"

# coordinator polls the handoff queue, then QAs
tasks list --state review
tasks update task-1a2b3c4d --state done --note "QA passed"
# …or send it back (a note is required):
tasks update task-1a2b3c4d --state todo --note "logout 500s — see step 3"

tasks show task-1a2b3c4d                     # full back-and-forth history
```

States flow `todo → doing → review → done`, with `blocked` to the side. `review` is the
QA-handoff signal. Any send-back (a backward move or `blocked`) requires a `--note`, so the next
actor always knows why.

### Web UI

A local web view of what needs you — escalated, blocked, reviews assigned to you, and your queue:

```bash
tasks ui --me <your-name>     # opens a local browser UI over the same store
```

The inbox is live; the full board and task-detail views are in progress.

### MCP

The same operations are available to agents as MCP tools:

```bash
claude mcp add agent-tasks -- tasks mcp
```

Exposes `add_task`, `list_tasks`, `get_task`, `update_task`, `claim_task` over the same store.

## Requirements

- [Bun](https://bun.sh) to build from source. The compiled binary has no runtime dependency.

## License

[MIT](LICENSE)
