# UI design kickoff prompt

Paste the block below into Claude (pair it with the `figma-generate-design` skill, or just use it
for a design conversation / mockups).

---

You are designing the web UI for **agent-tasks**, a local-first task tracker that coordinates work
across multiple AI coding agents (and me, the human). Agents and I log tasks, claim them, hand them
off for QA, and poll for state changes. There is already a CLI and an MCP server writing to a local
SQLite store; this UI reads the same data.

**The UI's #1 job: surface what needs MY (the human's) attention, clearly and at a glance.** Most of
the work happens agent-to-agent without me. The UI exists so I can see, in one glance, the few things
that are waiting on me — and act on them.

## What "needs a human" means (design the inbox around this)
- **Escalated** (`needsHuman: true`): an agent explicitly flagged that it needs a person — a
  credential, an approval, a judgement call. Each escalation carries a required note saying what's
  needed. This flag is orthogonal to state (a task can be `doing` and still need a human). This is
  the primary, structured "needs me" signal — make it the loudest.
- **Assigned to me**: any task whose assignee is me, in any state.
- **Review awaiting me**: tasks in `review` (QA handoff) assigned to me rather than a QA agent.
- (`blocked` is a workflow state — blocked on another task — distinct from `needsHuman`. A task can
  be both; show both.)

This "Needs you" inbox is the hero of the UI. Everything else (the full board) is secondary.

## Workflow & states
States flow `todo → doing → review → done`, with `blocked` to the side. `review` is the QA-handoff
signal. Transitions that send work *backward* (e.g. `review → todo` rejection) or into `blocked`
**require a note** — the UI must enforce/encourage that note on those actions.

Typical loop: someone logs a task (`todo`) → an agent claims it (`doing`, stamping the git branch +
worktree where it's working) → moves it to `review` when ready → a coordinator/QA passes it (`done`)
or rejects it back with a note. The back-and-forth between worker and QA is the task's history.

## Data model (one task)
- `id`, `title`, `description` (what's being done), `plan` (the approach/steps)
- `state`: todo | doing | review | done | blocked
- `needsHuman` (boolean): escalated, waiting on a person — orthogonal to state
- `project` (the git repo), `branch`, `worktree` (where the work happens — stamped on claim)
- `assignee` (free-text actor: an agent name, or me), `createdBy`
- `createdAt`, `updatedAt`
- `history`: an append-only audit trail. Each event = `{ at, actor, from, to, note }`. State changes
  record from→to; notes capture QA feedback, rejection reasons, context. This history IS the
  conversation between worker and QA — render it as a timeline.

## Screens / components to propose
1. **Needs-you inbox** (landing): the human-attention items above, prioritized and scannable. Each
   card shows title, state badge, project, the reason note (for blocked/rejected), who's waiting, and
   the primary action (unblock, QA pass/reject, etc.). Make "blocked" visually loudest.
2. **Board / list**: all tasks with filters (state, project, assignee, "updated since"). Dense,
   scannable, keyboard-friendly. Group or filter by project (I work across many repos/worktrees).
3. **Task detail**: full task + the history timeline (worker↔QA exchange), plan, branch/worktree,
   and the transition actions. The send-back action must prompt for a required note.

## Design constraints & taste
- Developer tool: dense, fast, scannable, keyboard-first. Terminal-adjacent aesthetic is welcome.
  Not a consumer SaaS dashboard.
- Light and dark themes.
- Strong visual language for state (the five states) and for "needs human" urgency (badges/color/
  ordering). Blocked and rejected items should be impossible to miss.
- Local-first and real-time-ish: the data changes as agents work, so design for live updates / polling
  and for empty, loading, and "nothing needs you right now" states.

## Deliver
Information architecture, the key screens (low-fi wireframes or Figma frames), a component breakdown,
the state/empty/loading variants, and the visual system (color, type, spacing, the state + urgency
language). Start with the Needs-you inbox.
