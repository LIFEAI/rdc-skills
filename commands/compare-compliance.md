---
name: compare-compliance
description: "rdc:compare-compliance <path> --diff <ref> — gate a change against a ref: did compliance get worse"
---

# compare-compliance

Use Skill tool with skill: "solid-validator", passing the path and a
required `--diff <ref>` as args. Read `regressions` and `boundaryViolations`
from the output — either non-empty means the change made compliance worse
than the base ref, not merely "still imperfect."
