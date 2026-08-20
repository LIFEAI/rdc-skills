---
name: quick-check
description: >-
  Usage `rdc:quick-check <path>` — fast mechanical-only pass: solid-validator
  score + boundary check. No dispatched judgment agents. For a tight
  iteration loop, not a merge gate.
---

# quick-check

Use Skill tool with skill: "solid-validator", passing the path as args.
This is the mechanical-only subset — no judgment dispatch, meant to run in
seconds during active editing. Use `full-analysis` before a merge.
