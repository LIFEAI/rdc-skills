---
name: solid-validator
description: "rdc:solid-validator (path) - [--diff, --config] — the FORM corner of the form/fit/function model"
---

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `.rdc/guides/agent-bootstrap.md`) — this is also where the global rdc-harness-use policy for create/open/build/deploy work lives.
> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# solid-validator — Deterministic SOLID + Clean Architecture Scoring

## Why this one is mechanical, not a dispatched agent

Three other skills in this suite (`architecture-reviewer`,
`clean-code-analyzer`, `package-design`) dispatch `pr-review-toolkit:code-reviewer`
for judgment; `pattern-advisor` and `pattern-refactoring-guide` produce
recommendations/plans without a dispatch, and `testing-strategy` recommends
a level/shape rather than scoring anything. This one does not dispatch a
judgment agent at all, on purpose: a ratchet gate that blocks a merge
on regression needs a NUMBER two runs can be diffed against, and an LLM
judgment call is not deterministic enough for that job. `git` is the baseline
— `--diff <ref>` scores each unit twice (at `<ref>` and in the working tree)
and gates on the delta, so nothing here persists a baseline file that can
drift out of sync with reality.

Dogfooded: `rdc-harness`'s `Harness` god-object scores 68.5/100 on the
weighted SOLID sum (SRP=40, three disconnected components across 21 members
— real cohesion signal) while the boundary check independently fails it on
all 6 of its declared ports. Two checks, proven necessary together — DIP's
generic concrete-instantiation-ratio metric alone did NOT catch the
violation (a class with almost no dependencies of any kind scores fine on
it), which is why the boundary rule exists as a separate, named check rather
than folded into DIP's score.

## Arguments

- `rdc:solid-validator <path>` — full score, current working tree
- `rdc:solid-validator <path> --diff <ref>` — regression gate against `<ref>`
- `rdc:solid-validator <path> --config <file>` — weights/thresholds/boundaries

## Procedure

1. **Run the scorer:**
   ```bash
   rdc-solid-score <path> --diff <ref> --config <repo>/.solid-score.yml --format json
   ```
   (installed globally via `npm link`/publish from this package — see
   `package.json`'s `bin.rdc-solid-score`; falls back to
   `node <rdc-skills-install-path>/scripts/solid-score.mjs` if the bin isn't
   on PATH.)

2. **Read `results`** — per-unit SRP/OCP/LSP/ISP/DIP scores with confidence
   (`high`/`low-medium`/`low` — OCP and LSP are heuristic by nature; report
   the confidence, never hide it).

3. **Read `regressions`** (only present with `--diff`) — any unit whose
   score dropped more than `diff.maxDecrease` (default 0, i.e. no regression
   tolerated) versus the base ref, or any NEW unit below `diff.newUnitMin`.

4. **Read `boundaryFindings`** — named Clean Architecture dependency-rule
   violations from the repo's configured `boundaries` list. Treat these as
   equally load-bearing as a regression — they catch a different failure
   shape (see the `Harness` case above).

5. **Read `unresolvedLanguages`** — files no registered plugin could parse.
   Report them explicitly; do not silently treat them as passing. (Day-1
   plugin: TypeScript/JavaScript via `ts-morph`. A Python plugin implementing
   the same `lib/language-plugin.mjs` contract extends coverage without
   touching this skill or the scoring core.)

6. **Report:**
   ```
   ## SOLID + Clean Architecture Score
   | Unit | SRP | OCP | LSP | ISP | DIP | Total |
   ### Regressions (vs <ref>)
   ### Boundary violations
   ### Unresolved languages (no plugin — not silently passed)
   ## Verdict: CLEAN / HAS ISSUES
   ```

## Rules

- Never treat an `unresolvedLanguages` entry as a pass — it is unmeasured,
  not clean.
- A boundary violation is a hard block regardless of the weighted score —
  do not let a high SOLID total offset a missing required port import.
- Confidence is reported data, never a reason to omit OCP/LSP scores.
