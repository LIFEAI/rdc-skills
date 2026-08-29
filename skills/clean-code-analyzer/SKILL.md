---
name: clean-code-analyzer
description: rdc:check-clean-code (path) - [--diff] — naming, dead code, function-size, and error-handling smells outside SOLID's scope (SOLID governs class/modu...
---

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `.rdc/guides/agent-bootstrap.md`) — this is also where the global rdc-harness-use policy for create/open/build/deploy work lives.
> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# clean-code-analyzer — Naming, Dead Code, Function Size, Error Handling

## Scope — what this covers that solid-validator doesn't

`solid-validator` scores the SHAPE of a class/module (cohesion, coupling,
inheritance contracts). This skill covers what's INSIDE that shape: does a
name lie about what it does, is there code nothing calls, is a function too
big to hold in one head, is an error silently swallowed. Two different
failure classes; a class can score perfectly on SOLID and still be unreadable.

## Why 8 of these rules are mechanical, not a dispatched agent

Same reasoning as `solid-validator`: a rule that names a real AST fact
(a declared binding's name and length, a numeric literal's declaration
context, a statement count, a parameter count, an empty catch block, an
unreachable constant-conditional branch, a cross-file reference count) does
not need LLM judgment to detect — it needs the same NormalizedUnit contract
`lib/language-plugin.mjs` already defines, extended with the facts these
rules read (`statementCount`, `declaredNames`, `magicNumbers`, `emptyCatches`,
`deadConditionals` — see that file's JSDoc — plus the OPTIONAL
`deadExportsOf(filePath, projectFilePaths)` plugin method for G9's
cross-file half). All eight live in `scripts/lib/clean-code-scoring.mjs` as
pure functions over a `NormalizedUnit`, exactly like `solid-scoring.mjs`.

Detection logic (thresholds, patterns) is ported/adapted from
architecture-toolkit's real implementation —
github.com/OnSightTeam/architecture-toolkit (MIT),
`src/agents/clean-code-analyzer/tools/{naming,function,code-smell}-validator.ts`
— with per-rule citations in `clean-code-scoring.mjs`'s own comments. Their
checks are whole-file text regexes with an occurrence-count threshold (e.g.
"flag single-letter names only if more than 3 appear in the file", to
suppress the regex's own false-positive rate); ours reads the real AST per
declared binding, so context is known directly and every genuine occurrence
is its own finding — no threshold needed. F1 (>20 statements) and F2 (>3
params) independently corroborate architecture-toolkit's own real thresholds
at `function-validator.ts:52` and `:82`.

Dogfooded live against this repo's own `scripts/` tree (75 files): N1 fired
271 times, N4 223 times, F1 53 times, E1 31 times, F2 10 times, G9 5 times
(3 confirmed by independent repo-wide grep: `registeredPlugins`,
`packageMetrics`, `cleanupStaleWorktrees` — genuinely zero callers). N7 fired
0 times on real code (no `*Manager`/`*Handler`/`*Util` names in this repo) —
confirmed against a constructed fixture instead. N2's low-confidence label is
earned: it also produced one real false positive (`pm2`, a product name,
matches the numeric-suffix heuristic) alongside real hits (`data`, `temp`,
`val`) — report it as a heuristic finding, never a certainty.

## Procedure

1. **Run the mechanical scorer:**
   ```bash
   rdc-clean-code-score <path> [--project-root <dir>] [--no-dead-exports] --format json
   ```
   (installed globally via `npm link`/publish — see `package.json`'s
   `bin.rdc-clean-code-score`; falls back to
   `node <rdc-skills-install-path>/scripts/clean-code-score.mjs`.)

2. **Read `results`** — per-unit findings for N1 (cryptic names), N2 (heuristic
   meaningless-distinction names, low confidence), N4 (magic numbers), N7
   (generic class/function names), F1 (>20 statements), F2 (>3 params), E1
   (empty catch blocks), and G9 (dead code — BOTH halves: unreachable
   constant-conditional branches, always measured, AND unused exports via a
   real cross-file `findReferencesAsNodes()` reference-graph walk, measured
   only when `deadExportsScope.positiveControlOk` is true).

3. **Read `deadExportsScope`** before trusting ANY G9 unused-export finding.
   `positiveControlOk: false` means the cross-file reference scan itself
   failed a known-used-symbol control — G9's export-usage findings are
   withheld entirely in that case (the unreachable-conditional half still
   ran). An unverified "zero callers" is a guess, not a finding — see
   `.claude/rules/prove-absence-positive-control.md`.

4. **Naming-honesty judgment pass — this stays a dispatched agent, on
   purpose.** N1/N2/N7 catch SHAPE (a name too short, too generic, or
   suspiciously paired) — none of them can tell whether a name LIES about
   behavior (a function named for its happy path that also has a side
   effect, a boolean named affirmatively that is usually false, a variable
   whose name predates a refactor and no longer matches its contents). That
   needs reading intent against implementation, which is judgment:
   ```
   Agent({
     subagent_type: "pr-review-toolkit:code-reviewer",
     description: "clean-code naming-honesty pass",
     prompt: "Review `git diff <ref>...HEAD` for names that misdescribe what
              the code does — not too short or too generic (a mechanical
              scorer already caught that), but SEMANTICALLY WRONG: a
              happy-path name hiding a side effect, an affirmative boolean
              that's usually false, a name that predates a refactor. High-
              confidence findings only. Return CLEAN_CODE_NAMING_COMPLETE
              with { findings: [{file:line, name, issue, suggested_name}] }."
   })
   ```

5. **Report:**
   ```
   ## Clean Code Analysis
   ### Mechanical findings (N1/N2/N4/N7/F1/F2/E1/G9) — rdc-clean-code-score
   ### Dead-export scan status (positive control OK / withheld — reason)
   ### Naming-honesty findings (dispatched judgment)
   ### Not implemented (see below)
   ## Verdict: CLEAN / HAS ISSUES
   ```

## Not implemented — named, not faked

These stayed OUT of the mechanical catalog because a cheap regex/AST version
would report a confident number for evidence that's actually a judgment call,
which is worse than not measuring it. Route these through a dispatched
`pr-review-toolkit:code-reviewer` pass reading the real diff, same shape as
step 4, or accept they are genuinely unmeasured this round:

| ID | Why it stays judgment |
|----|------------------------|
| N3 | Unpronounceability is a phonetic/readability judgment, not an AST fact — a consonant-run regex flags real acronyms and abbreviations as often as bad names. |
| N5, N6 | Member-prefix (`m_`/`_`) and interface-`I`-prefix conventions are STYLE-GUIDE-dependent, not universal Clean Code violations — some house styles mandate them. Flagging them needs the repo's own convention as ground truth, which isn't in `NormalizedUnit`. |
| C1–C5 | Comment quality/staleness needs comparing prose against code behavior over time — semantic, not structural. |
| G5 | Duplication detection worth trusting needs real similarity (token/AST-diff) across the whole codebase, not a per-file line-repeat count — a per-unit, per-file scorer is the wrong shape for a cross-file structural-clone problem. |
| G14 | "Feature Envy" (a member using another object's data more than its own) needs cross-class field-access comparison this scorer doesn't do — SRP's connected-component analysis in `solid-scoring.mjs` is the adjacent real check, not a substitute. |
| G16, G28 | Nested-ternary / complex-boolean "obscures intent" is a readability judgment about a specific reader's tolerance, not a fixed threshold — a mechanical AST-depth count would either flag idiomatic short expressions or miss genuinely tangled ones depending on where the line is drawn. |

## Rules

- Dead-export (G9) claims MUST cite the positive control that proved the scan
  itself works — `deadExportsScope.positiveControlOk` — an unverified "zero
  callers" claim is not a finding, it's a guess with a command attached.
- N2 findings are heuristic and low-confidence BY DESIGN — report them as
  "worth a look," never as certain violations. A real false positive
  (`pm2` flagged as a "numeric-suffix" name) was found during dogfooding and
  is why this label is load-bearing, not decorative.
- Do not flag a name as wrong without a suggested replacement — "confusing"
  alone is not actionable.
- Never claim a Not-Implemented rule (N3/N5/N6/C1-C5/G5/G14/G16/G28) was
  checked — it wasn't, on purpose.
