# Relay direction + implementation plan

Planning artifact (not for commit unless we decide to). Captures the steward/QA/drainer
redesign and how to recast relay's prompts in the Sisyphus (oh-my-openagent) style.

## The direction, in one invariant

**You get pulled exactly once per task — at `ready` — and only after the QA worker has
both code-reviewed it and manually exercised the running app, with evidence attached.**
Everything else (CI, automated/PR review comments, send-backs, stalled-agent nudges) happens
without you. The store enforces this; it is not a prompt promise.

Goal is staged ("both"): Phase 0/1 lock the store + protocol; Phase 2 layers the personas
and autonomy on top.

## Personas (enforced by tool access, not just prose)

OMO denies `write`/`edit`/`task` to read-only agents so role purity is structural. We mirror it:

| Persona         | Owns                                                                                                                                    | Must NOT                        | Lifetime                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| **Steward**     | the one interactive session you keep alive; routes events; pulls you only at `ready`; preps your env; nudges/re-dispatches stalled work | implement; merge                | long-lived                                                             |
| **QA worker**   | code review + manual (live) test; writes evidence + gates; extends the QA brain                                                         | implement; merge                | per-review-task, then dies (persistent specialist first — see Phase 2) |
| **Drainer**     | implement; make CI green; address PR/Jira review comments before handoff                                                                | review; merge; design decisions | per-task, interactive terminal (human-booted)                          |
| **Human (you)** | final code review + test at `ready`; merge                                                                                              | —                               | —                                                                      |

0fab462 reworded: ban _implementer_ spawning; explicitly allow ephemeral QA-worker sub-agents.

## Sisyphus prompt patterns we adopt (and where)

1. **Never-idle loop.** End the turn with a backgrounded `relay watch` armed; the watch return
   is the wake. Sisyphus: "END YOUR RESPONSE. The system will send `<system-reminder>`… NEVER
   poll before it." Ours: never a `sleep` loop; the armed watch is the only terminal state.
   → steward prompt + Stop hook.
2. **RE-READ RULE (anti-drift).** Momus: "a previous verdict cannot be trusted without re-reading
   from disk." Ours: re-read `relay show <id>` every turn; never trust cached state. The store is
   the source of truth, not the agent's context. → every relay prompt + `relay status`.
3. **Obsessive external tracking.** Sisyphus: "OBSESSIVELY TRACK YOUR WORK USING TODO TOOLS." Ours:
   the relay store IS that list, and it survives the agent dying. Re-anchor from it each turn.
4. **Delegation prompt = 6 mandatory sections.** TASK / EXPECTED OUTCOME / REQUIRED TOOLS /
   MUST DO / MUST NOT DO / CONTEXT. "Vague prompts = rejected." → steward→QA delegation; mirrors
   `relay add --desc/--plan` extended with must-not + how-to-test.
5. **Post-work verification checklist.** "Does it work? Follows codebase pattern? Expected result?
   Followed MUST/ MUST-NOT?" → QA worker prompt.
6. **Momus approval bias (anti-bounce).** "When in doubt APPROVE; BLOCKER-finder not perfectionist;
   max 3 issues; don't force revision cycles." → QA worker prompt. Antidote to review↔todo loops.
7. **Concrete QA scenarios required.** Each task carries a tool + concrete steps + expected result;
   "verify it works"/"check the page" is rejected. → the test-handoff payload + a gate check.
8. **Evidence or it didn't happen.** codex-qa: "the captured JSON/pane IS the evidence; no evidence
   file == the QA did not happen." → the `manual-test` gate requires an attached artifact (screenshot
   / captured output), not a boolean. Hardens asserted gates against faking.
9. **Bugfix Rule: fix minimally, never refactor while fixing.** → drainer prompt.
10. **Isolation for QA.** codex-qa runs against an isolated home, asserts the real one is untouched.
    Ours: QA always runs against a temp `$RELAY_DIR` store (already the test convention).

### From the rest of the pantheon (Atlas, Hephaestus, Metis)

11. **Manual QA Gate (Hephaestus) — the centerpiece.** Verbatim-worthy: "'Done' requires the
    artifact has been driven through its matching surface — you personally used the deliverable and
    observed it working — within this turn. Reading the source and concluding 'this should work' does
    NOT pass this gate." Plus the surface→tool table: CLI/TUI → launch, run happy path + one bad input
    - `--help`; Web → drive a real browser, click/fill, watch console, screenshot; API → curl the live
      process; library → a driver script; no surface → "how would a real user discover this works? do
      exactly that." → This IS "I shouldn't have to ask if it QA'd live." Lift near-verbatim into the QA
      worker prompt (and the drainer's pre-handoff self-check). The `manual-test` gate's evidence is the
      artifact this produces (screenshot / captured output).
12. **AUTO-CONTINUE (Atlas) — anti-stop in prose.** "NEVER ask the user 'should I continue' /
    'proceed to next task'. Auto-continue immediately after verification passes. Only pause if truly
    blocked by missing info, external dependency, or critical failure." Hephaestus echoes it: "Status
    requests are not stop signals: give the update, keep working." → steward + drainer. Pairs with the
    Stop hook: the hook is the floor, this is the policy.
13. **Notepad / Inherited Wisdom (Atlas) — generalizes the QA brain to ALL agents.** Atlas keeps
    `.omo/notepads/{plan}/{learnings,decisions,issues,problems}.md`; every delegation reads it FIRST
    and the prompt carries an "Inherited Wisdom" block; workers APPEND (never overwrite). → relay: a
    per-project/workstream notepad that drainers + QA workers read before acting and append to. The
    durable cross-agent memory; the QA `references/` are a specialization of it.
14. **Intent classification + "Must NOT Have" (Metis).** Classify each task (refactor / build / mid-
    sized / architecture / research) and write an explicit exclusions section to prevent AI over-
    engineering. → how the steward/human writes a task: `--desc` (what) + `--plan` (how) + a MUST-NOT.
15. **Three debugging hypotheses with evidence (Hephaestus) — anti-false-certainty.** "Record at
    least three debugging hypotheses with the runtime evidence confirming or refuting each" before
    declaring done. → drainer + QA worker; matches our "theories not verdicts" discipline.
16. **After compaction, continue from the summary; don't restart (Hephaestus).** Plus "re-read on
    every task hand-off, even when the request feels familiar." → reinforces the RE-READ RULE as a
    cross-agent invariant, and explicitly handles context loss.

### The OMO planning pipeline (optional, later)

OMO's flow is Metis (classify + pre-plan) → Prometheus (plan via interview, `.md`-only) → Momus
(review plan for executability + that every task has concrete QA scenarios) → Atlas (orchestrate +
Final Verification Wave) → workers → QA gate. We don't need the full pipeline, but two pieces are
worth stealing now: **Momus's "every task must carry an executable QA scenario or it's rejected"**
(feeds our test-handoff gate, pattern 7) and **Atlas's Final Verification Wave as a distinct phase**
(our `review`→`ready` gate is exactly that — QA is the goal, implementation is the means).

## Phase 0 — hygiene (no CLI change; ~half day)

- **Collapse the three instruction sources to one.** `prompts/`, `commands/`, `skills/` contradict
  (coordinator merges directly in `prompts/coordinator.md` step 6, but gates on `ready` in
  `skills/coordinate/SKILL.md`). `CLAUDE.md` still says the state machine ends at `done` (it's
  `merged`). Pick `skills/` as canonical; make `prompts/` + `commands/` thin pointers or delete.
- Reword 0fab462 (implementer-spawn ban; allow QA sub-agents).

## Phase 1 — store/protocol primitives (CLI work)

1. **Evidence-gated `ready`** [card: task-84d8c181]. Add agent-evidence fields distinct from the
   human checkpoints (`humanReviewed`/`humanTested`): e.g. `qaCodeReviewed`, `qaManualTested`, each
   with a required evidence link. In `store.update`, reject `review → ready` unless both are present
   with evidence — same shape as the existing `--tested`-required-for-`merged` guard. CLI flags:
   `--qa-code-reviewed`, `--qa-manual-tested <evidence-url>`.
2. **Test-handoff payload** [task-2616b671]. Add `envUrl` + `howToTest` task fields; the steward
   replays them to prep your env. Reject vague `howToTest` at the `ready` gate (pattern 7).
3. **Jira connector** [task-f53f4730]. New `jiraConnector` in the existing registry; poll a linked
   Jira issue, fold status/comments onto the task via `syncLink`. Highest-leverage "it just happens".
4. **`relay agents` status + watchable staleness** [task-cdc25e7c]. active/idle/stale; emit "agent
   stale with task in `doing`" as an event `relay watch` can return on, so the steward re-dispatches.
5. **`relay status` / `whoami`** [NEW card]. One call → this agent's role, in-flight task, next step.
   The re-anchor primitive (pattern 2/3).
6. **`relay message` / `relay inbox`** [task-b592ffcc]. Steward→drainer nudge channel so a stalled
   drainer is poked by the steward, not by you.
7. **GH connector: PR mergeable-state, not just review+CI** [NEW card, HIGH — validated by a real
   session, see below]. The connector already polls `reviewDecision` + `statusCheckRollup`. Add:
   - **Stale-review detection.** Compare each review's commit SHA (`reviews[].commit.oid`) to the PR
     head (`headRefOid`). A `CHANGES_REQUESTED` on a non-head commit is STALE → label `review-stale`,
     do NOT drive the task to `todo`. This alone removes the single biggest source of confusion.
   - **Mergeable state.** Poll `mergeable` + `mergeStateStatus`. Map: `BEHIND` → needs-rebase,
     `DIRTY`/conflicting → needs-conflict-resolution, `BLOCKED` → needs-review/checks, `CLEAN` → ok.
     A `BEHIND`/`DIRTY` PR sitting in `ready` bounces to a drainer ("rebase me"), it doesn't stall.
   - **CI failure detail.** Surface the failing check name + URL from `statusCheckRollup` onto the
     task note (so the drainer gets "backend-tests-2 failed: <link>" without hand-rolling CircleCI
     API calls). Provider log-fetch (CircleCI) is a stretch goal, not v1.

### Failure routing (cause → role, attempt-capped) — settled

Materialized as an extension of the existing pure `driveTaskState` (`src/connectors/index.ts`):
today `(remote status) → state`; becomes `(cause, attempt) → (state, role, note)`. Three primitives:

1. **Typed `cause`** stamped on every backward transition (`ci-test`, `ci-infra`, `flake`, `conflict`,
   `changes-requested`, `design`). Connector + QA worker set it. Keep the taxonomy to ~6; no rules
   engine.
2. **Attempt count = a query over immutable history**, never a stored counter. The loop guard lives
   in the store, computed from facts the agent can't forget, fake, or lose on death — same philosophy
   as the never-idle hook externalizing liveness.
3. **Routing table** (pure function):
   - `ci-test` round 1 → `todo`/drainer/"fix \<check\>"
   - `ci-test` round 2–3 → `todo`/drainer/"**materially different approach** — N failed attempts"
   - `ci-test` round ~4 → escalate/human
   - `ci-infra` → escalate/human (don't route a non-code failure to a drainer)
   - `conflict`/`behind` → `todo`/drainer/"rebase" (safe-rebase guardrail: never `reset`+drop commits)
   - `changes-requested` (head SHA) → `todo`/drainer/the comments
   - `changes-requested` (stale SHA, ≠ head) → label `review-stale`, no transition
   - `flake` (a check's conclusion flipped without `headRefOid` change, detected from `link.lastStatus`)
     → re-run/wait, route to nobody

**Ladder leans autonomous**: ~3 agent↔agent rounds before escalating to the human; configurable per
project. The `review→todo` loop with required notes already IS the drainer↔QA feedback channel, and
history accumulates it, so a later-round drainer reads earlier QA notes instead of starting blind.

**Why this is safe to ship small**: classification (infra-vs-code) will be imperfect, but the attempt
ladder is the safety net — a misrouted `ci-infra` fails to fix, climbs the ladder, and escalates
anyway. Convergence matters, not perfect classification.

## Phase 2 — personas + autonomy (skills + one hook)

1. **Steward skill** [NEW, recut from `coordinate`]. Interactive, long-lived. Loop: arm
   `relay watch --project <p> --timeout <long>` in background → on event, re-read via `relay status`
   /`relay show` → route → act → re-arm. Pull human only at `ready`, with env prepped. Adopts
   patterns 1–4.
2. **Stop hook (relay ships it)** [NEW card]. Block the steward's turn-end unless a backgrounded
   `relay watch` is armed OR a fresh "awaiting-human-reply" sentinel exists (set when it asks you a
   direct question). The structural enforcement of pattern 1. Accept the small faking risk (auditable).
3. **QA worker skill + durable QA brain** [task-374176a9 = `relay:qa`]. Structure mirrors codex-qa:
   - `skills/relay-qa/SKILL.md` — router: change scope → which check.
   - `skills/relay-qa/references/{cli,ui,store,mcp}.md` — per-area how-to + gotchas (incl. Playwright
     learnings for board drag, inbox sorting, etc.).
   - `skills/relay-qa/scripts/{seed-store.sh, cli-smoke.sh, ui-drive.mjs}` — each with `--self-test`.
   - Golden rules: isolated `$RELAY_DIR` temp store; capture evidence under an evidence dir and attach
     the link to the task (pattern 8). Prompt adopts Momus approval bias (pattern 6) + checklist (5).
   - Rollout: start as ONE persistent QA specialist that _builds_ the brain; switch to ephemeral
     workers once references+scripts carry the knowledge.
4. **Drainer recut** [edit `drain`]. Owns CI-green + addresses PR/Jira comments before handoff.
   Adds: Manual QA Gate self-check before handoff (pattern 11), Bugfix Rule (9), RE-READ RULE (2/16),
   auto-continue (12, "status requests aren't stop signals"), 3-hypotheses-with-evidence (15), and an
   "Inherited Wisdom" read of the project notepad before implementing (13).
5. **Project notepad** [NEW card, small]. A per-project `notepad/{learnings,gotchas,decisions}.md`
   (in-repo or relay-attached) that drainers + QA workers read first and append to. Generalizes the
   QA brain to all cross-agent memory (pattern 13).

## Deferred (off the autonomy critical path)

- **Workstream/group axis** [task-886e6473] — organizational; defer.
- **UI attention treatment** [task-81e16bd0] — you don't use the UI; the steward is the attention
  surface. Downgrade to backup.

## Board reshuffle (relay project)

| Card                                         | Action                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| task-84d8c181 Human sign-off gate + priority | retitle → "Evidence-gated `ready` (qa-code-reviewed + qa-manual-tested)"; label `phase-1`                          |
| task-2616b671 Test-handoff payload           | keep; label `phase-1`; note: reject vague how-to-test                                                              |
| task-f53f4730 Jira connector                 | keep; label `phase-1`                                                                                              |
| task-cdc25e7c relay agents status board      | keep; label `phase-1`; add "+ watchable staleness event"                                                           |
| task-b592ffcc relay message + inbox          | keep; label `phase-1`                                                                                              |
| task-374176a9 relay:qa skill                 | retitle → "QA worker skill + durable QA brain (SKILL+references+scripts)"; label `phase-2`                         |
| task-886e6473 workstream axis                | label `deferred`                                                                                                   |
| task-81e16bd0 needs-intervention UI          | label `deferred`                                                                                                   |
| NEW                                          | "Phase 0: collapse prompts/commands/skills to one source + fix CLAUDE.md state machine + reword 0fab462" `phase-0` |
| NEW                                          | "relay status / whoami re-anchor command" `phase-1`                                                                |
| NEW                                          | "Steward skill + Stop hook (always-armed watch)" `phase-2`                                                         |

## Open decisions

- **One pull at `ready` (test+review together) vs two separate pulls.** Recommend one.
  Affects whether Phase-1 #1 is one gate or two.
- **Persistent QA specialist → ephemeral workers**: when do we flip? Proposed trigger: when the
  `relay-qa` scripts+references cover CLI + UI + store without the specialist's memory.
