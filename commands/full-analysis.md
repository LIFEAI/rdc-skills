---
name: full-analysis
description: rdc:full-analysis <path> [--diff <ref>] — run all seven review surfaces over a path
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# full-analysis — Complete Form/Fit/Function Pass

## Order — mechanical first, judgment second, refactor plans last

1. **FORM** — Skill tool, skill: "solid-validator" (path, `--diff`)
2. **FIT** — Skill tool, skill: "architecture-reviewer" (path, `--diff`) —
   reuses step 1's `boundaryFindings`, does not re-run the mechanical check.
3. **FUNCTION** — Skill tool, skill: "testing-strategy" (path)
4. **Naming/dead-code/complexity** — Skill tool, skill: "clean-code-analyzer"
5. **Package boundaries** — Skill tool, skill: "package-design"
6. **Patterns** — Skill tool, skill: "pattern-advisor"
7. **For every HIGH/CRITICAL finding from steps 1-6** — Skill tool, skill:
   "pattern-refactoring-guide", one dispatch per finding, producing a
   concrete plan.

## Report

```
## Full Analysis — <path>
### FORM (solid-validator)
### FIT (architecture-reviewer)
### FUNCTION (testing-strategy)
### Clean Code
### Package Design
### Pattern Suggestions
### Refactor Plans (for every high/critical finding above)
## Verdict: CLEAN / HAS ISSUES
```

## Rules

- Do not re-run the mechanical boundary check inside step 2 — pass step 1's
  result through.
- A CLEAN verdict requires all seven surfaces to report clean, not a
  majority.
