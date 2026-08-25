---
name: package-design
description: >-
  Usage `rdc:package-design <path>` — module boundary and export-surface
  review: does this package expose the right things, hide the right things,
  and sit at the right size.
---

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `.rdc/guides/agent-bootstrap.md`) — this is also where the global rdc-harness-use policy for create/open/build/deploy work lives.
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

4. **Dependency direction — mechanical, real numbers.** Run
   `node scripts/package-metrics-cli.mjs <packagesRoot>` (root containing
   `packages/*`, or `--dirs <d1,d2,...>` for an explicit set). This is a
   REAL package-dependency graph, not a `package.json` `dependencies` read —
   many real monorepos (rdc-harness among them) declare zero
   `dependencies` and wire packages together entirely through relative
   `../../pkg/src/...` imports, which `package.json` alone can't see. It
   resolves every `import`/`export ... from`/`require()`/dynamic `import()`
   across every sibling package (implementation: `scripts/lib/package-metrics.mjs`,
   independent of the ts-morph `language-plugin.mjs` used by SRP/OCP/etc —
   plain-text/regex parsing, so it works on any language whose imports look
   like ES/CJS syntax) and reports, per package:

   | Metric | Meaning | Formula |
   |---|---|---|
   | `ca` | how many OTHER packages import from this one | count of distinct importing packages |
   | `ce` | how many OTHER packages this one imports from | count of distinct imported packages |
   | `instability` (I) | Ce/(Ca+Ce); `null` if Ca+Ce=0 (isolated, no coupling data — not 0) | Martin's I |
   | `abstractness` (A) | exported `interface`/`type` ÷ exported total (`class`/`function`/`const`/…); `null` unless the package contains at least one real `.ts`/`.tsx` file | Martin's A |
   | `distanceFromMainSequence` (D) | how far off Martin's main sequence; `null` if either I or A is null | `\|A + I − 1\|` |
   | `cycles` | REAL cycle paths through this package (e.g. `a -> b -> c -> a`), not just "a cycle exists" | ADP — Acyclic Dependencies Principle |
   | `zone` | `main-sequence` (D≤0.5) / `zone-of-pain` (I<0.5, A<0.5) / `zone-of-uselessness` (I>0.5, A>0.5) / `off-main-sequence` / `unmeasurable` | |

   **Honest limits, not fabricated numbers:** `abstractness` is `null` for a
   plain `.mjs`/`.js` package — there is no type system to measure, and
   reporting a fake 0 would silently claim "fully concrete" for a package
   this tool has no basis to judge. Measurability is decided by file
   EXTENSION (does the package contain a real `.ts`/`.tsx` file), never by
   whether `interface`/`type` keywords happen to appear — a `.ts` package
   with zero interfaces is a real, legitimate A=0, not "unmeasurable" (this
   was a real bug, caught by a synthetic fixture during dogfooding, fixed
   before ship). Declaration counting excludes test files — a test fixture
   that embeds source-as-a-STRING (e.g. a template literal holding
   `` `export interface Page {...}` `` as test input) is indistinguishable
   from a real declaration to a regex scanner; `ca`/`ce` still count
   test-file imports, since those are real coupling regardless.

   Dogfooded against `rdc-harness/packages/*` (21 packages, zero `.ts`
   files, zero `package.json` `dependencies` entries — everything wired via
   relative imports): every `ca`/`ce` number was hand-verified against a
   manual `grep -rn "from '\.\./\.\./"` cross-check across the whole tree,
   with one instructive miss — a dynamic `await import('../../delivery/src/...')`
   inside `adoption/test/isolation-and-adoption.test.mjs` that the naive
   `grep ... from` positive control doesn't catch (no `from` keyword on a
   dynamic import) but this tool correctly does. Zero ADP cycles found,
   confirmed by hand against the full 22-package edge list. `abstractness`
   was `null` for all 22 — correct, since the fleet has no TypeScript.

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
   ### Dependency-direction — Ca/Ce/I/A/D/zone table (from package-metrics-cli.mjs), cycles called out by name
   ## Verdict: CLEAN / HAS ISSUES
   ```

## Rules

- An export-usage claim needs the same positive control as dead-code
  detection — prove the scan works before trusting a zero result.
- Do not recommend splitting or merging a package without naming the exact
  target shape — "this is too big" alone is not actionable.
- Ca/Ce/I/A/D/zone/cycles are MECHANICAL (step 4) — never eyeball or
  estimate these from reading `package.json`/imports; run
  `package-metrics-cli.mjs` and quote its numbers. A `zone-of-pain` or
  `zone-of-uselessness` verdict, or any reported `cycles` entry, needs the
  actual tool output in the report, not a paraphrase.
