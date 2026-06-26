---
name: rdc:edit
description: >-
  Usage `rdc:edit <site|brand|route|file>` — open a target in the local website editor host on port 3015. Resolves the site, launches or reuses the editor, and opens the target URL when available.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.

# rdc:edit — Local Website Editor

Use `skills/edit/SKILL.md` as the source of truth.

## When to Use

- The user wants to open a site or route in the local editor app
- The user says "open this in the editor" or "edit this site"
- The target belongs in `@regen/editor-host`, not Studio

## Arguments

- `rdc:edit <site|brand|route|file>`

## Notes

- `prtrust.fund` and `dev.prtrust.fund` resolve to the `prt` brand/app pair.
- `test`, `studio_test`, and `studio-test` resolve to the bundled local test target.
- Under `RDC_TEST=1`, report the resolved editor URL instead of forcing a foreground browser action.
