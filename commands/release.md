---
description: >-
  Atomic release. Usage `rdc:release <repo> [version]` or `rdc:release <repo> --patch|--minor|--major|--dry-run` — bump, commit, tag, push, wait CI/publish, install, and verify. Uses repo-local release metadata.
---

# rdc:release — Generic Release

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No raw git/npm/CI dumps.
> One checklist upfront, updated in place, shown again at end with 1-line verdict.

## Checklist

```
rdc:release: <repo> vX.Y.Z -> vA.B.C
[ ] Source path resolved
[ ] Release metadata read
[ ] Working tree clean or user-approved dirty scope identified
[ ] Current version detected
[ ] New version computed
[ ] Dry-run gate handled
[ ] Version files updated
[ ] Tests/self-test passed
[ ] Commit created
[ ] Tag created
[ ] Branch and tag pushed
[ ] CI/publish status verified
[ ] Registry/package/deploy target shows vA.B.C, if applicable
[ ] Local install/update executed, if applicable
[ ] Installed/runtime version verified
[ ] Smoke test passed
✅ rdc:release <repo>: vA.B.C live and verified
```

## Rules

- Do not release without explicit user authorization.
- Prefer repo-local release instructions in `.rdc/release.json`, README, package scripts, or CI workflows.
- Never force push or bypass hooks.
- Never declare success without verifying the installed or deployed version.

## RDC Skills Package

After publishing this package to npm, a clean-box install should use:

```bash
npm install -g @lifeaitools/rdc-skills@latest
rdc-skills-install --profile core
```
