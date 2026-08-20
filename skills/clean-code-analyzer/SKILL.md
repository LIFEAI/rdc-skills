---
name: clean-code-analyzer
description: >-
  Usage `rdc:clean-code-analyzer <path> [--diff <ref>]` — naming, dead code,
  and complexity smells outside SOLID's scope (SOLID governs class/module
  shape; this governs whether the code inside is readable and honest about
  what it does).
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# clean-code-analyzer — Naming, Dead Code, Complexity

## Scope — what this covers that solid-validator doesn't

`solid-validator` scores the SHAPE of a class/module (cohesion, coupling,
inheritance contracts). This skill covers what's INSIDE that shape: does a
name lie about what it does, is there code nothing calls, is a function's
control flow too tangled to hold in one head. Two different failure classes;
a class can score perfectly on SOLID and still be unreadable.

## Procedure

1. **Dead code — this is not a guess, it's a call-graph fact:**
   `scripts/lib/plugins/typescript.mjs` has no export-enumeration seam today
   (its `LanguagePlugin` contract exposes only `extractUnits`/`importsOf` —
   see `scripts/lib/language-plugin.mjs`). Until that's added, enumerate
   exported symbols directly with `ts-morph` (`sourceFile.getExportedDeclarations()`)
   or an equivalent for the target language, then grep the WHOLE project
   (production code, not just tests) for each name. An exported symbol with
   zero production call sites is a finding — name it, don't estimate it.
   Positive control: confirm a KNOWN-used export scans as non-zero with the
   same query before trusting any zero result.

2. **Naming — dispatch judgment, this is not mechanical:**
   ```
   Agent({
     subagent_type: "pr-review-toolkit:code-reviewer",
     description: "clean-code naming pass",
     prompt: "Review `git diff <ref>...HEAD` for names that misdescribe what
              the code does: a function named for its happy path that also
              has a side effect, a boolean named affirmatively that is
              usually false, a variable whose name predates a refactor and
              no longer matches its contents. High-confidence findings only.
              Return CLEAN_CODE_NAMING_COMPLETE with
              { findings: [{file:line, name, issue, suggested_name}] }."
   })
   ```

3. **Complexity — branch density per function/method**, reusing
   `branchHitsOf` in `scripts/lib/plugins/typescript.mjs` (switch cases +
   instanceof/typeof + if-else chains — the same signal OCP scoring
   consumes in `solid-scoring.mjs`, computed by the plugin, not the scoring
   layer). There is no configured threshold today — report the actual
   branch-hit count per member and let the reviewer judge it in context,
   rather than gate on an unconfigurable number.

4. **Report:**
   ```
   ## Clean Code Analysis
   ### Dead code (zero production callers, control verified)
   ### Naming findings
   ### Complexity (function : cyclomatic count)
   ## Verdict: CLEAN / HAS ISSUES
   ```

## Rules

- Dead-code claims MUST cite the positive control that proved the scan
  itself works — an unverified "zero callers" claim is not a finding, it's
  a guess with a command attached.
- Do not flag a name as wrong without a suggested replacement — "confusing"
  alone is not actionable.
