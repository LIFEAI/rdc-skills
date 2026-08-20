---
name: pattern-advisor
description: >-
  Usage `rdc:pattern-advisor <path>` — suggests an applicable design pattern
  for a given code shape. Advisory only; never rewrites code itself.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# pattern-advisor — Design Pattern Suggestions

## The failure this guards against

A pattern applied because it's a pattern, not because the code needs it, is
the same kind of theater as a test written to make a claim go green. This
skill's first output for most inputs should be "no pattern needed" — that is
a valid, common, correct answer, not a non-answer.

## Procedure

1. **Name the actual shape present**, not the pattern you're about to
   recommend — e.g. "five branches switching on a type tag to pick behavior"
   is the shape; Strategy or a lookup table is the candidate pattern. Naming
   the shape first stops the recommendation from being pattern-first.

2. **Check whether `solid-validator`'s OCP finding already flagged this
   file** — a high branch-density score is the most common trigger for a
   real Strategy/Visitor/lookup-table recommendation. Reuse that evidence
   instead of re-deriving it.

3. **Recommend, with the concrete alternative named:**
   - Type-switch selecting behavior → Strategy, or a plain lookup object if
     the branches have no shared interface need.
   - Object constructed from a long, mostly-optional parameter list →
     Builder, or named-options object if the construction has no ordering
     constraints (don't reach for Builder when a plain object literal does
     the job).
   - A class whose subclasses override one method that changes only the
     "what," never the "how" → Template Method, or straight composition if
     there's no shared "how" worth abstracting.
   - Repeated `if (x) { A } else { B }` where A/B are chosen by an external
     flag threaded through many call sites → Strategy injected at
     construction, not a flag threaded through every call.

4. **State the "no pattern needed" case explicitly when it applies** — a
   small, stable branch count with no growth signal is not a pattern
   candidate; recommending one there is the failure this skill exists to
   prevent.

5. **Report:**
   ```
   ## Pattern Advice
   | File:Line | Shape observed | Recommendation | Why now (not speculative) |
   ```

## Rules

- Never recommend a pattern without naming the shape it responds to.
- "No pattern needed" is a first-class, expected verdict — report it as
  plainly as a positive recommendation.
- Do not write the refactor here — hand off to
  `pattern-refactoring-guide` for the concrete before/after.
