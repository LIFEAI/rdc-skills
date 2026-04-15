---
name: rdc:release
description: >-
  Atomic release for LIFEAI packages (clauth, rdc-skills, regen-media, etc.):
  bump → commit → tag → push → wait for CI → install → verify → restart if
  needed. One command, no handoff. Use EVERY TIME a LIFEAI source repo needs
  publishing. Supersedes the manual "bump and ask Dave to install" pattern.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw git/npm/CI dumps.
> One checklist upfront, updated in place, shown again at end with 1-line verdict.

# rdc:release — Atomic LIFEAI Package Release

## Purpose

Dave has Bash access. Therefore Dave should never be asked to run install
commands. This skill handles the complete release loop for any LIFEAI-published
package so the user sees one checklist and one verdict, not a series of "now run
this" handoffs.

## Arguments

- `rdc:release <repo>` — patch bump (default), full loop
- `rdc:release <repo> <version>` — explicit version (e.g. `1.6.0`)
- `rdc:release <repo> --minor` | `--major` | `--patch` — semver bump
- `rdc:release <repo> --dry-run` — show checklist and planned version, do nothing
- `rdc:release` (no args) — list known repos, ask which

## Known repos

Resolve `<repo>` to source path + install mechanism:

| Repo | Source path | Publish | Install | Post-install |
|------|-------------|---------|---------|--------------|
| `clauth` | `C:/Dev/clauth` | npm via tag → GitHub Actions | `npm install -g @lifeaitools/clauth@latest` | `curl -s -X POST http://127.0.0.1:52437/restart` |
| `rdc-skills` | `C:/Dev/rdc-skills` | local (no npm) | `bash C:/Dev/rdc-skills/scripts/install.sh` + cp fallback | none |
| `regen-media` | `C:/Dev/regen-root/mcp-servers/regen-media` | local | restart MCP server | none |
| `gws` | `C:/Dev/regen-root/mcp-servers/gws` | local | restart MCP server | none |

Add new repos to this table as they emerge. If user specifies an unknown repo,
ask for the source path and install command.

## Checklist (run every mode)

```
rdc:release: <repo> vX.Y.Z → vA.B.C
[ ] Source path resolved
[ ] Working tree clean (git status)
[ ] Current version detected (package.json)
[ ] New version computed
[ ] Dry-run gate (if --dry-run, stop here)
[ ] package.json bumped (all version fields)
[ ] Commit created
[ ] Tag vA.B.C created
[ ] Push to origin
[ ] Push --tags to origin
[ ] CI run located (gh run list, if applicable)
[ ] CI completed successfully (poll every 20s, 10min timeout)
[ ] npm registry shows vA.B.C (if npm package, poll every 15s, 3min timeout)
[ ] Local install executed
[ ] Installed version verified matches vA.B.C
[ ] Post-install action (daemon restart, etc., if applicable)
[ ] Smoke test (ping health endpoint or binary --version)
✅ rdc:release <repo>: vA.B.C live and installed
```

## Execution details (silent to user — don't narrate)

### 1. Version bump
- Read `package.json`, parse version
- Apply bump: patch (default), minor, major, or explicit
- Rewrite all `version` fields (some packages have version in `claude.version` too)

### 2. Commit + tag + push
```bash
cd <source_path>
git add package.json
git commit -m "chore(release): vA.B.C"
git tag vA.B.C
git push && git push --tags
```
Never `--no-verify`. Never `--force`. If pre-commit hook fails, fix root cause, don't skip.

### 3. CI poll (for repos with GH Actions publish)
```bash
# Locate the run triggered by the tag push
gh run list --repo LIFEAI/<repo> --limit 5 --json status,conclusion,headBranch,databaseId
# Poll its status field every 20s until conclusion ∈ {success, failure, cancelled}
# Max 10 minutes — if timeout, fail with [!] and report run URL
```

### 4. npm registry poll (only if published to npm)
```bash
npm view @lifeaitools/<repo> version
# Poll every 15s until matches new version
# Max 3 minutes — usually lands within 30-60s after CI success
```

### 5. Install
- **clauth:** `npm install -g @lifeaitools/clauth@latest`
- **rdc-skills:** `bash C:/Dev/rdc-skills/scripts/install.sh` — if output shows only one file copied (known bug), fall back to `cp C:/Dev/rdc-skills/skills/*.md ~/.claude/skills/user/ && cp C:/Dev/rdc-skills/skills/*.md C:/Dev/regen-root/.claude/skills/user/`
- **MCP servers:** restart the server process (find its PID, kill, respawn — or document how)

### 6. Verify install
- **clauth:** `curl -s http://127.0.0.1:52437/ping | jq -r .app_version` — must equal new version
- **rdc-skills:** `ls ~/.claude/skills/user/rdc-release.md` (or whichever file is new in this release) — must exist
- **Global npm:** `npm list -g --depth=0 @lifeaitools/<repo>` — version matches

### 7. Post-install
- **clauth:** `curl -s -X POST http://127.0.0.1:52437/restart` — wait 3s — ping again
- Others: N/A

### 8. Smoke test
- **clauth:** new tool roundtrip (e.g., `curl -s http://127.0.0.1:52437/get/openai | head -c 10` succeeds without error)
- **rdc-skills:** load one new skill file and check frontmatter parses
- **MCP:** server responds to `tools/list`

## Failure modes → checklist outcome

| Failure | Marker | Next |
|---------|--------|------|
| Dirty working tree | `[!]` line 2 | Abort with one-sentence diff summary; ask user to commit or stash |
| Pre-commit hook fails | `[!]` line 7 | Fix root cause, re-stage, retry (NEVER --no-verify) |
| CI fails | `[!]` line 11 | Print run URL, tail 20 lines of failing job, ask user |
| npm doesn't register | `[!]` line 12 | Print npm error, check if CI actually published (not a silent skip) |
| Install script broken | `[!]` line 13 | Fall back to manual cp; note the installer bug as a task |
| Version mismatch after install | `[!]` line 14 | Uninstall + clean install; if still wrong, likely cache issue |
| Post-install restart fails | `[!]` line 15 | Print ping error; instruct user to run `scripts\restart-clauth.bat` manually |

Even on failure, show the full checklist with `[!]` markers so user sees exactly
where it stopped.

## Dry-run mode

Prints the checklist + resolved version bump + every command that WOULD run, but
executes nothing beyond reads. Use when user says "what would you do" or before
risky major bumps.

## Never

- Never release on behalf of the user without an explicit `rdc:release` invocation
- Never skip CI verification ("it'll probably work" is how stale installs happen)
- Never `--force` push, never `--no-verify`, never `--no-gpg-sign`
- Never touch `main` — release tags go on the default branch the repo uses (`master` for clauth, rdc-skills)
- Never declare success without verifying the installed version matches

## Related

- `.claude/rules/clauth.md` — clauth release workflow source of truth
- `feedback_version_bump_must_tag.md` (memory) — never bump without tagging
- `feedback_clauth_ci.md` (memory) — CI publish pattern
- `feedback_just_do_it.md` (memory) — don't hand commands to Dave; run them
