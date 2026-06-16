#!/usr/bin/env bun
// PreToolUse guard: a coordinator/steward may spawn only an ephemeral read-only QA worker; deny anything else.

const actor = process.env.RELAY_ACTOR ?? ''
const governed = actor.startsWith('coordinator') || actor.startsWith('steward')

const input = await Bun.stdin.json().catch(() => ({}))
const { subagent_type = '', description = '' } = input?.tool_input ?? {}
const isQaWorker = /qa/i.test(subagent_type) || /^qa:/i.test(description.trim())

if (!governed || isQaWorker) process.exit(0)

const reason =
  "A relay coordinator may spawn only a QA worker (subagent_type containing 'qa', " +
  "or description prefixed 'qa:'). Never spawn a drainer or any implementer — you " +
  'QA and steer, you never implement by proxy. Let todo work wait for a human-booted ' +
  'drainer, and monitor the queue with `relay watch --project <project>` (blocking CLI).'

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })
)
