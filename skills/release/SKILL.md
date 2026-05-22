---
name: rdc:release
description: "Usage `rdc:release <repo> [version|--patch|--minor|--major|--dry-run]` — bump, commit, tag, push, wait for CI/publish, install, and verify a package or project using repo-local release metadata."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw git/npm/CI dumps.
> One checklist upfront, updated in place, shown again at end with 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.

# rdc:release — Generic Release

## When to Use

- The user explicitly asks to release, publish, promote, ship, tag, or bump a repo.
- A package or app needs versioning plus verification.
- A repo provides release metadata in `package.json`, `.rdc/release.json`, README release instructions, or CI config.

Never release without explicit user authorization.

## Inputs

- `rdc:release <repo>` — patch release by default.
- `rdc:release <repo> <version>` — explicit version.
- `rdc:release <repo> --patch|--minor|--major`
- `rdc:release <repo> --dry-run`

If `<repo>` is not resolvable from the current workspace, ask for its local path or GitHub slug.

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

## Resolution Order

1. Current repo if `<repo>` is `.` or omitted and the user clearly refers to the current workspace.
2. Sibling directory matching `<repo>`.
3. GitHub slug `<owner>/<repo>`.
4. Repo-local `.rdc/release.json` if present.
5. Ask for the missing path or release mechanism.

## Generic Commands

Use repo-local package tooling when available. Examples:

```bash
npm version patch --no-git-tag-version
npm test
git add package.json package-lock.json
git commit -m "chore(release): vA.B.C"
git tag vA.B.C
git push origin HEAD
git push origin vA.B.C
npm view <package-name> version
```

Never use `--force` or bypass hooks. If a hook fails, fix the cause.

## RDC Skills Package

For this package, prefer the npm installer binary after publish:

```bash
npm install -g @lifeaitools/rdc-skills@latest
rdc-skills-install --profile core
```

Use `--profile lifeai` only on a workstation that intentionally has the LIFEAI project layout and services.
