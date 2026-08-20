---
name: package-design
description: >-
  Usage `rdc:package-design <path>` — module boundary and export-surface
  review: does this package expose the right things, hide the right things,
  and sit at the right size.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# package-design — Module Boundary & Export-Surface Review

## Procedure

1. **Read the package's barrel** (`src/index.ts`/`.mjs`) and list every
   export. For each: is it used by anything OUTSIDE the package? An export
   used only internally is an encapsulation leak — it should not be public.
   Use the same call-graph approach as `clean-code-analyzer`'s dead-code
   check, with the same positive-control requirement.

2. **Check for a missing barrel** — internal files imported directly by
   other packages (`import { x } from '../../foo/src/internal/thing.mjs'`
   instead of `from '../../foo/src'`) is a boundary violation even when
   nothing is technically broken; it means the package has no real public
   contract, just whatever consumers happened to reach into.

3. **Size check** — a package with one export and a package with sixty are
   both worth asking about. Too small: does this need to be its own package,
   or is it one file that belongs inside a consumer? Too large: does it
   actually have one responsibility, or has "utils"/"shared"/"core" become
   several unrelated things sharing a directory (the same LCOM-style
   cohesion question `solid-validator`'s SRP score asks, applied at the
   package level instead of the class level).

4. **Dependency direction** — does this package's own `package.json` list
   dependencies that suggest it's reaching UP (a "core"/"shared" package
   depending on something that depends on it) or SIDEWAYS beyond what its
   name promises?

5. **Dispatch judgment for what's not mechanical:**
   ```
   Agent({
     subagent_type: "pr-review-toolkit:code-reviewer",
     description: "package-design judgment pass",
     prompt: "Review the package at <path>: does its actual responsibility
              match its name and its README/CLAUDE.md description? Would a
              new contributor guess what belongs here correctly? Return
              PACKAGE_DESIGN_COMPLETE with
              { findings: [{severity, issue, suggestion}] }."
   })
   ```

6. **Report:**
   ```
   ## Package Design Review
   | Export | Used externally? | Should be public? |
   ### Boundary leaks (direct internal imports from outside)
   ### Size/cohesion note
   ### Dependency-direction note
   ## Verdict: CLEAN / HAS ISSUES
   ```

## Rules

- An export-usage claim needs the same positive control as dead-code
  detection — prove the scan works before trusting a zero result.
- Do not recommend splitting or merging a package without naming the exact
  target shape — "this is too big" alone is not actionable.
