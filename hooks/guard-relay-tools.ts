#!/usr/bin/env bun
// PreToolUse guard for relay sessions: built-in Task* tools are not the relay queue, and a coordinator/steward may spawn only a QA worker.

const input = await Bun.stdin.json().catch(() => ({}))
const tool = input?.tool_name ?? ''
const actor = process.env.RELAY_ACTOR ?? ''
if (!actor) process.exit(0)

function deny(reason: string): never {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  )
  process.exit(0)
}

const TODO_TOOLS = [
  'TaskCreate',
  'TaskList',
  'TaskUpdate',
  'TaskGet',
  'TaskOutput',
  'TaskStop',
]
if (TODO_TOOLS.includes(tool)) {
  deny(
    `${tool} is your in-session scratch list, NOT the relay queue. Relay state lives only behind the relay CLI via Bash: read with "relay list" or "relay show", write with "relay add", "relay update", "relay claim". The built-in Task tools never reflect relay.`
  )
}

const governed = actor.startsWith('coordinator') || actor.startsWith('steward')
if ((tool === 'Task' || tool === 'Agent') && governed) {
  const { subagent_type = '', description = '' } = input?.tool_input ?? {}
  const isQaWorker =
    /qa/i.test(subagent_type) || /^qa:/i.test(description.trim())
  if (!isQaWorker) {
    deny(
      "A relay coordinator may spawn only a QA worker (subagent_type containing 'qa', or description prefixed 'qa:'). Never spawn a drainer or any implementer; comment on the todo and let a human-booted drainer take it."
    )
  }
}

process.exit(0)
