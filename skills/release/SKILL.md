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
[ ] PUBLISH.md status gate: status=active AND prod in environments (block if not)
[ ] Source path resolved
[ ] Release metadata read
[ ] Working tree clean or user-approved dirty scope identified
[ ] Current version detected
[ ] New version computed
[ ] Dry-run gate handled
[ ] Version files updated
[ ] Tests/self-test passed
[ ] Mandatory release code-review (pr-review-toolkit:code-reviewer on `git diff <last-released-tag>..HEAD`). Block release on `critical`/`high` findings; record `medium`/`low` in the release notes and proceed.
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

## PUBLISH.md Status Gate (Step 0 — before any production-touching step)

Before touching any production system, read `PUBLISH.md` from the app root and validate promotion eligibility.

```bash
PUBLISH_MD="<monorepo_path>/PUBLISH.md"
```

**Block promotion if ANY of the following are true:**

1. **PUBLISH.md is missing AND the app has a row in `app_deployments`** — emit warn and continue (during rollout period); becomes a hard block after Option A rollout is complete.
2. **PUBLISH.md exists AND `status` field is NOT `active`** — hard block regardless of rollout status.
   - `status: draft` → `BLOCKED: PUBLISH.md status=draft for <slug> — promote requires status=active`
   - `status: deprecated` → `BLOCKED: PUBLISH.md status=deprecated for <slug> — promote requires status=active`
3. **PUBLISH.md exists AND `environments` array does not include `prod`** → `BLOCKED: PUBLISH.md environments=[dev] for <slug> — prod must be declared before promotion`
4. **Any required surface field is missing** (`source_dir` or `path` absent on any surface) → `BLOCKED: PUBLISH.md surface <id> missing required field for <slug>`

If blocked, abort immediately with the message above. Do NOT proceed to the version bump, commit, or any Coolify call.

If PUBLISH.md is absent and app has no `app_deployments` row (library/package), skip this gate.

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
