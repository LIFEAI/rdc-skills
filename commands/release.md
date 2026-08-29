---

description: rdc:release (repo, [version]) - [--patch, --minor, --major, --dry-run] — bump, tag, publish and verify a package
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

For a `package`-class target that already resolves through `rdc-harness`
(a real monorepo subtree, not a standalone repo like this one), its
`packages/deploy/src/runners/registry-release.mjs` runner already proves the
"Tests/self-test passed" through "Local install/update executed" steps
safely — real `npm pack`, isolated-prefix install (never the real global
store), real verify, and `--live` explicitly gates the actual publish. Where
applicable, `node C:/Dev/rdc-harness/bin/rdc-harness.mjs deploy <slug>
[--live]` can supply those checklist rows' evidence directly instead of
hand-rolling the same pack/install/verify cycle. This does not replace
version bump/tag/push — the harness CLI does neither.

## RDC Skills Package

After publishing this package to npm, a clean-box install should use:

```bash
npm install -g @lifeaitools/rdc-skills@latest
rdc-skills-install --profile core
```
