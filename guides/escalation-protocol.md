# Truth-Gain Escalation Protocol — Claude ↔ Codex

> Shared governance protocol for peer agent collaboration. Referenced by
> `rdc:co-develop` and (when built) `rdc:ccandme`.
> Approved: option-1 — shared guide + ref from both skills; trigger = two
> consecutive sub-threshold rounds. Interview: 2026-06-07 in this session.

---

## Purpose

Two capable agents debating a question can spend unbounded rounds for shrinking
returns. This protocol bounds the debate: when an exchange stops materially
moving the answer, the agents **stop arguing and decide** — via a scored rubric
for ordinary decisions, or by escalating to the human for critical ones. Every
decision leaves an auditable record (bridge-mode Rule 4: deterministic,
replayable, human-in-the-loop).

It governs any governed co-development or deep-planning exchange:

- `rdc:co-develop` — headless clauth/HTTP JSON-envelope transport
- `rdc:ccandme` — visible WezTerm routing (proposed)

---

## 1. Truth-gain (Δ) per round

After each peer round, the **receiving** agent rates the round's marginal
truth-gain:

> **Δ = the fraction of remaining decision-relevant uncertainty that this
> exchange actually closed** — through new evidence, a corrected error, a
> resolved disagreement, or a narrowed option set.

Δ measures whether the **answer moved**, not whether the agents talked.
Restating a position, agreeing without adding, or circling = Δ ≈ 0.

---

## 2. Stop trigger — two consecutive sub-5% rounds

A round is **sub-threshold** only when **both** agents independently rate
Δ < 5%. If either agent still sees ≥ 5% gain, the dialogue continues — this
resolves "who owns Δ?": neither agent owns it unilaterally; the debate stops
only when both agree it is thin.

The trigger fires after **two consecutive sub-threshold rounds**. One thin round
can be rescued by a strong follow-up; two in a row means the dialogue has
converged or stalled.

Convergence counts: mutual agreement at Δ < 5% is a valid stop (the answer is
settled, not stalled). Record it as a decision and proceed — no rubric needed.

---

## 3. On trigger → scored rubric (stop debating)

When the trigger fires on an *unresolved* question, do **not** keep debating.
Jointly construct a rubric:

1. **Enumerate live options**, including the status quo / do-nothing.
2. **Define 3–6 weighted criteria.** Default set: correctness, reversibility,
   bridge-mode fit, cost, risk, time. Weights sum to 1.0.
3. **Each agent scores every option independently** (no peeking at the peer's
   sheet) on each criterion.
4. **Combine** by weighted sum; the higher combined score wins.
5. **Record both scoresheets** verbatim as evidence — they are the audit trail.

---

## 4. Criticality gate

Classify the pending decision:

- **Non-critical** → adopt the rubric winner. Record the decision plus both
  scoresheets. Proceed.
- **Critical** → do **not** auto-adopt. Escalate **HITL** (human-in-the-loop):
  emit a human decision item containing the rubric, both scoresheets,
  agreements, disagreements, and a single recommendation. Then **wait** for the
  human's decision.

### Critical = any of:

- a trigger in `.claude/rules/architectural-change-approval.md`
- production / deploy-facing change
- security / credentials
- destructive schema (DROP / RENAME / reshape)
- money, credits, valuations
- governance or source-of-truth definition
- **rubric tie**, or agents still diverge past a one-rank margin after scoring
- high irreversibility (hard or impossible to undo)

When in doubt, treat it as critical.

---

## 5. HITL sink — interim reality

The intended sink is the `human_items` **decision table** described in
`docs/systems/claude-workflow/HUMAN-INBOX.md`.

**As of 2026-06-07 that table is not built** (verified: no `human_items`
relation exists; only `codeflow_policy_decisions`). Until it ships:

- HITL = surface the rubric + both scoresheets + recommendation to Dave
  in-session, and record it as a `work_item` note and/or CodeFlow memory.
- Migrate these records to `human_items` decision rows once that surface exists.

Do **not** treat the missing table as a reason to auto-adopt a critical
decision (bridge-mode: absence of an artifact is not licence for drift —
build/route around it, keep the human in the loop).

---

## Acceptance criteria

A session that uses this protocol must, in its report, show:

1. Δ ratings per round from both agents (or a note that convergence was reached).
2. If the trigger fired: the rubric — options, weighted criteria, both
   scoresheets, combined result.
3. The criticality classification and which trigger(s) matched.
4. For critical decisions: the HITL record (human item / interim note) and the
   human's decision, or `status: awaiting_human`.
5. No critical decision auto-adopted without a human decision on record.
