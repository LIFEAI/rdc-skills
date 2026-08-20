---
name: compare-compliance
description: >-
  Usage `rdc:compare-compliance <path> --diff <ref>` — the SOLID/Clean
  Architecture regression gate: did this change make compliance worse than
  `<ref>`? Wraps solid-validator's git-diff mode.
---

# compare-compliance

Use Skill tool with skill: "solid-validator", passing the path and a
required `--diff <ref>` as args. Read `regressions` and `boundaryViolations`
from the output — either non-empty means the change made compliance worse
than the base ref, not merely "still imperfect."
