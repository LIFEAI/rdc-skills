---
name: testing-strategy
description: >-
  Usage `rdc:testing-strategy <path>` — recommends the right TEST LEVEL and
  SHAPE for a surface (unit/integration/live tier, assertion vs golden-capture),
  not a specific test to write. The FUNCTION corner of the form/fit/function
  model — solid-validator covers FORM, architecture-reviewer covers FIT, this
  covers whether a surface's behavior is actually provable, and how.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# testing-strategy — Test Level & Shape Recommendation

## The distinction this exists to enforce

A test can be green and prove nothing — this session's own history: a
proof-ledger claimed 144/144 while grading each row against evidence weaker
than the row demanded, because the tests were written to make a NAMED CLAIM
go green rather than to capture real behavior. This skill's job is to say,
BEFORE a test is written, what level and shape it needs to be honest —
catching that failure at design time instead of at a review months later.

## Level — pick the lowest that can still prove the claim

| Level | Proves | Fixture allowed? |
|---|---|---|
| **Unit** | pure function, one input/output contract | yes — the function IS the boundary |
| **Integration** | real adapters composed across a package boundary | disposable repo/worktree/registry fixture, never a stub standing in for the boundary itself |
| **Live** | a real external outcome (real git, real process, real HTTP) through the authoritative source | no — a fixture at this level is a downgrade, not a shortcut |

A claim that says "delivers," "deploys," "persists," or "ships" needs live
tier. A claim about a pure calculation needs unit tier and nothing more —
forcing live tier on a pure function is not rigor, it's noise that hides the
real live-tier gaps under a pile of slow, brittle tests.

## Shape — assertion vs golden-capture

Ask: **can the author state, in one sentence, exactly what "correct" means
before running the code?**

- Yes → assertion-based test. Write the expectation, then the test.
- No (the correct shape is "whatever the real system currently does, until a
  human reviews a change") → golden-capture. Run the seam, record the FULL
  observable result (return value, thrown error, side-effect journal), diff
  future runs against it. A delta is a question for a human, never an
  auto-pass or auto-fail.

Golden-capture is not a lesser form of testing — it exists specifically
because assertion-writing failed on complex orchestration surfaces this same
session: the author cannot accidentally assert something weaker than the
truth when they are not choosing what to assert.

## Procedure

1. **Identify the surface's SEAM** — its real, production-called entry point.
   If nothing in production calls it, that is not a testing question, it's an
   `architecture-reviewer` finding (dead code / no production caller) —
   route it there first. A test cannot prove a surface has no reason to exist.

2. **Classify the claim** the surface makes (calculation / composition /
   external effect) and pick the LOWEST level from the table above that can
   prove it. State the level explicitly in the checklist row — not "tested",
   but "unit: pure function" / "integration: composed across guard+delivery
   against a disposable worktree" / "live: real git commit against a
   disposable repo".

3. **Pick assertion vs golden-capture** using the one-sentence test above.

4. **For a claim naming an outcome word** (delivers/deploys/persists/ships/
   writes) — require a positive control: the SAME test run against a target
   KNOWN to succeed, before trusting a negative result from it. A test that
   never proves it CAN detect failure proves nothing when it passes.

5. **Report:**
   ```
   ## Testing Strategy
   | Surface | Claim | Level | Shape | Positive control needed? |
   ```

## Rules

- Never recommend live tier for a pure function, or unit tier for an
  external-effect claim — matching level to claim is the whole point.
- A recommendation with no seam identified is incomplete — say so, don't
  guess a seam that doesn't exist in production.
- This skill recommends; it does not write the test. Pair with the actual
  build task.
