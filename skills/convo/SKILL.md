---
name: convo
description: "rdc:convo — fair attributed discussion using six reusable templates, shared sources, explicit dissent and durable decisions; not an implementation dispatch."
---

> **OUTPUT CONTRACT:** `guides/output-contract.md`. Show the selected template,
> discussion progress and decision boundary, not transport logs.
> **Sandbox contract:** Under `RDC_TEST=1`, do not contact live peers or mutate
> external state. Return a labeled simulated discussion packet; absent peer
> responses remain UNKNOWN, never simulated agreement.

# rdc:convo — shared deliberation, explicit decisions

Invoke `rdc:convo <template> <topic>`. Templates: `outcome-exploration`,
`design-comparison`, `troubleshooting`, `plan-critique`,
`disagreement-resolution`, `work-handoff`.
All six templates are included here so MCP callers receive the complete contract.
Use for a requested discussion, co-design or second opinion. Ordinary questions
do not need a peer round. Implementation stays in `rdc:plan` / `rdc:build`.

## Shared contract — applies to every template

1. Preserve the user's exact outcome, scope and permissions. Choose the closest
   template; announce a template switch without resetting the round count.
   Default budget: at most three completed rounds, up to 600 words per peer per
   round, equal opportunity to respond. These are defaults, not authority to
   shorten content the user explicitly requested. Finish early when resolved.
2. Name participants by actual engine/person and session identity; use UNKNOWN
   for unavailable identity or version. Roles (proposer, challenger, recorder,
   decision owner) come from the task, not the engine brand. A workflow layer is
   context, not a participant. No automatic Claude-supervisor/Codex-worker split.
3. Build one source packet: verbatim user scope; template id and skill version
   (plugin version and/or repository revision, never guessed);
   repository/revision or document version; explicit file excerpts and observation
   list with as-of times; assumptions; authorized decision owner; recorder and
   record destination; round budget. Hash the exact UTF-8 packet with SHA-256.
   Send identical bytes to each peer and the hash separately. Each echoes the
   received hash; if it can independently hash the bytes, record that separately.
   A mismatch pauses decision-making until corrected; do not count an echo as an
   independent integrity check. Reissue a changed packet with a new hash to all.
4. Use an existing verified transport: `rdc:co-develop` for addressed peer turns,
   or `rdc:collab` for an already available native/relay participant. Load the
   selected transport procedure. Reuse its send/reply and session correlation,
   not its default role or write permissions. A person's reply in the current
   user session is also a valid transport for that person. This contract grants no
   implementation, commit, deployment, approval or task-completion authority.
   Do not create another queue, scheduler or transport. Never invent a reply.
5. Every turn carries discussion/session id, turn id, reply-to id, participant,
   round, packet hash and as-of. Replies distinguish AGREE, AMEND, DISAGREE,
   UNKNOWN and DEFER per point, with reasons and source references. Observed facts,
   supplied-source analysis and inference stay distinct. Preserve exact peer text;
   recorder summaries are separate and attributed. Silence is not agreement.
   A supplied-source peer review is not a claim the peer ran tests or read files.
6. Missing or delayed replies: inspect the same live process/session/turn handle.
   A polling timeout is not terminal and does not authorize another dispatch.
   Continue independent work while a confirmed live call runs. Report
   PEER_UNAVAILABLE only after a terminal result or missing handle is established;
   retain its evidence and unresolved points. Never replace a missing participant
   with the coordinator's answer. Stop debate at its agreed budget, recording
   unresolved positions rather than manufacturing consensus. An authorized
   decision owner may close as UNRESOLVED while a call remains live, recording
   its pending turn and handle. That does not mean PEER_UNAVAILABLE, cancel the
   call, or authorize re-dispatch; the owner retains responsibility for its result.
7. The user may name the recorder; otherwise the existing authorized coordinator
   records within the task's project. Only that recorder writes the discussion
   artifact, at the established project decision/report location. No authorized
   destination means return the record inline without a file write. Retain turns
   append-only within the record; later corrections reference the original turn.
   Share only task-relevant, authorized sources; omit credentials and unrelated
   private content. A durable decision contains the packet/version, attributed
   turns, accepted and rejected proposals with reasons, dissent, uncertainty,
   decision owner, artifact owner, next action and evidence required.
8. Label the outcome AGREED, DECIDED_WITH_DISSENT, UNRESOLVED or PEER_UNAVAILABLE.
   Only explicit assent supports AGREED. An authorized owner may decide without
   consensus, retaining the other position. A disagreement never grants new
   authority. For reversible in-scope decisions use existing delegation; ask the
   user or authorizing principal
   only when authorization or a material choice is genuinely missing.
9. Handoff proposes a bounded plan/build brief with accepted constraints, exact
   artifacts, ownership and failing acceptance checks. If execution is already
   authorized, the coordinator continues through the existing governed workflow;
   otherwise request that authority. Discussion does not close work items or
   advance Flowable stages. In CDE-Zoe, save durable decisions/artifacts to the
   authorized blackboard/project; retain conversation as transcript, not fabricated
   workflow state. An unavailable persistence route is reported as unsaved.

## Templates

Select one block and fill its inputs. The shared contract above supplies identity,
fairness, authority, recording and termination; do not duplicate or override it.

### outcome-exploration
```json
{
  "template": "outcome-exploration",
  "inputs": ["Exact desired change and beneficiary", "Company/program/project/topic scope, unknowns explicit", "Constraints and available observations"],
  "process": ["Separate purpose and outcome from proposed implementation", "Compare observable success and non-goals; expose missing assumptions"],
  "outputs": ["Outcome brief with acceptance evidence", "Non-goals and unresolved scope questions"],
  "owner": "Authorized outcome owner; recorder names the brief owner",
  "dissent": "Keep competing interpretations and whose evidence would distinguish them",
  "handoff": "rdc:plan with the accepted outcome; unresolved material scope remains explicit"
}
```

### design-comparison
```json
{
  "template": "design-comparison",
  "inputs": ["Accepted outcome and current architecture revision", "Candidate designs including reuse/no-change where viable", "Constraints and evaluation evidence"],
  "process": ["Evaluate each candidate against the same outcome criteria", "Challenge assumptions, interfaces and failure/recovery behavior; state costs without invented numbers"],
  "outputs": ["Chosen design or unresolved alternatives with rationale", "Required PRODUCT.md, DESIGN.md, WORKFLOW.md and plan changes, as applicable"],
  "owner": "Authorized design decision owner; one owner per artifact",
  "dissent": "Preserve rejected alternatives and the observation that could reopen the decision",
  "handoff": "rdc:plan or existing design stage; no build admission from discussion alone"
}
```

### troubleshooting
```json
{
  "template": "troubleshooting",
  "inputs": ["Observed symptom, time and exact affected surface", "Expected behavior and last known revision", "Logs/probes with secrets removed and hypotheses labeled"],
  "process": ["Distinguish measured failure from theories", "Choose a discriminating safe probe and compare its actual result; do not repeat failed guesses"],
  "outputs": ["Supported cause or remaining hypotheses", "Scoped repair proposal and regression that would fail before repair"],
  "owner": "Investigation owner; separately named repair owner",
  "dissent": "Retain contrary observations and unresolved causal claims",
  "handoff": "Existing fix/build workflow for authorized repair; no service restart merely because observation timed out"
}
```

### plan-critique
```json
{
  "template": "plan-critique",
  "inputs": ["User outcome and exact plan revision", "Checklist inputs, processing, outputs and evidence", "Architecture boundaries, dependencies and current implementation"],
  "process": ["Trace each user requirement to a deliverable and failing check", "Challenge missing handoffs, recovery and unsupported claims; avoid padding the checklist"],
  "outputs": ["Accepted plan amendments with exact affected sections", "Uncovered requirements and verification gaps"],
  "owner": "Plan owner records amendments; independent reviewer retains attribution",
  "dissent": "Keep disputed acceptance criteria and the evidence needed to resolve them",
  "handoff": "rdc:plan amendment, then rdc:build only under existing authorization and admission"
}
```

### disagreement-resolution
```json
{
  "template": "disagreement-resolution",
  "inputs": ["Exact disputed point and attributed positions", "Shared evidence and conflicting assumptions", "Decision owner, constraints and remaining round budget"],
  "process": ["Each peer states the other's position for correction before rebuttal", "Identify a discriminating observation or explicit tradeoff; record an owner decision if consensus is absent"],
  "outputs": ["Agreement, decision with dissent, or unresolved point", "Reopening condition and smallest next evidence step"],
  "owner": "Existing authorized decision owner, never a winner inferred from engine identity",
  "dissent": "Retain each final position; no majority vote or silence masquerading as assent",
  "handoff": "Bounded evidence task or authorized plan decision; escalation only for a genuinely missing authority"
}
```

### work-handoff
```json
{
  "template": "work-handoff",
  "inputs": ["Accepted outcome, decisions and unresolved constraints", "Exact repository, revision, work item and artifact locations", "Completed evidence, remaining work and permission boundaries"],
  "process": ["Receiver restates scope, dependencies and next executable action", "Reconcile gaps without relabeling unverified work as complete"],
  "outputs": ["Accepted handoff brief with one writer per artifact", "Remaining checks and restart instructions with current process handles if relevant"],
  "owner": "Sender owns provenance; named receiver accepts future work explicitly",
  "dissent": "Receiver lists unsupported claims, unavailable inputs and declined scope",
  "handoff": "rdc:build for implementation or rdc:plan for unresolved planning; discussion never substitutes for review or validator closure"
}
```

## Exit check

- [ ] Selected template and shared packet identified.
- [ ] Each peer's received-hash echo recorded; mismatches resolved before deciding.
- [ ] Actual responses attributed; disagreement and uncertainty retained.
- [ ] Outcome labeled AGREED, DECIDED_WITH_DISSENT, UNRESOLVED or PEER_UNAVAILABLE.
- [ ] Decision owner and artifact owner explicit; no implied permission expansion.
- [ ] Record saved through an authorized route, or explicitly unsaved.
- [ ] Next action handed to the existing workflow; no false completion claim.
