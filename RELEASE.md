# Release — @lifeaitools/rdc-skills

## Package

- **Registry:** npm `@lifeaitools/rdc-skills`
- **Repo:** `LIFEAI/rdc-skills` (standalone)
- **Default branch:** `master`

## Runtime boundaries

- The npm package distributes CLI/plugin skill files and the standard MCP server
  executable.
- Local installation registers the public MCP connector URL but does not launch a
  local MCP daemon or any process manager.
- The public rdc-skills MCP at `https://rdc-skills.regendevcorp.com/mcp` is the
  independently hosted, stateless surface used by claude.ai and any compatible
  MCP client. Its Linux runtime is the checked-in `rdc-skills-mcp.service`; it is
  not a PM2 process.
- Hosting and deployment of the public endpoint are separate from Windows
  package installation.

## Package release

```bash
# 1. Merge the feature branch to master
git checkout master
git pull --ff-only origin master
git merge <feature-branch> --no-edit

# 2. Bump the version — package.json AND the plugin manifest, they must match.
#    rdc-skills-self-test fails the whole run (plugin manifest FAIL) if they drift,
#    and .claude-plugin/plugin.json ships inside the published npm package, so a
#    stale plugin.json version is a real defect in the release, not a lint nit.
npm version patch|minor|major --no-git-tag-version
# then hand-edit .claude-plugin/plugin.json's top-level "version" field to match —
# there is no script for this yet, only the self-test catches drift after the fact.

# 3. Commit, tag, and push
git add package.json .claude-plugin/plugin.json
git commit -m "release: v$(node -e \"console.log(require('./package.json').version)\")"
git tag "v$(node -e \"console.log(require('./package.json').version)\")"
git push origin master --tags

# 4. Publish through the tag-triggered GitHub workflow

# 5. Verify the published package
npm view @lifeaitools/rdc-skills version
npm install -g @lifeaitools/rdc-skills@latest
npm list -g @lifeaitools/rdc-skills --depth=0
rdc-skills-self-test
# ^ run this LAST and read the verdict line, not just the section pass counts —
#   a plugin-manifest version mismatch prints as a single top-line FAIL above the
#   skill/guide tables, which all pass independently of it. Exit code 1 on drift.
```

## Public MCP release gate

Changes to the MCP server or served catalog are not complete until the
independently hosted endpoint has consumed the released package and these checks
pass:

```bash
curl -fsS https://rdc-skills.regendevcorp.com/health
REMOTE=1 node tests/mcp.test.mjs
REMOTE=1 node tests/curl-surface.test.mjs
```

The public `/health` version must equal the released npm version and its skill
count must match the packaged catalog. The local installer never restarts or
deploys that endpoint.

The Vultr host checks out this repository at `/srv/regen/rdc-skills` and runs the
server straight from that checkout, with production dependencies installed there
by `npm ci`. `/health`'s `git_sha` comes from `bin/rdc-skills-mcp.mjs`'s runtime
`git rev-parse HEAD`, resolved once when the process starts — NOT a stamped
`git-sha.json` (that file is `.gitignore`d on purpose — it's a pack-time-only
artifact for npm-installed copies; the updater deletes one if it appears in the
checkout). `version`, by contrast, is re-read from `package.json` on every
request, so **only `git_sha` proves the process restarted onto a release.**

**The host follows release tags by itself.** `rdc-skills-mcp-update.timer` runs
the updater ([`deploy/update-from-tag.sh`](deploy/update-from-tag.sh), installed
at `/usr/local/libexec/rdc-skills/` so no rollback can delete it) every five
minutes. The service is only ever restarted onto a **release**: the newest plain
`vX.Y.Z` tag merged into `master`, or the last release the updater proved serving.
Untagged commits, pre-releases and tags off `master` are never served — a checkout
pulled ahead to untagged `master` is moved back to the tag. The updater reinstalls
dependencies and unit files only when they differ from the last install, restarts
the MCP, and succeeds only when `/health` reports the release's version **and**
commit. "Current" is decided by `/health`, never by where `HEAD` is — a run that was
interrupted converges on the next tick.

A release only moves forward: a tag that is not a descendant of the proved release
(a higher number put on an older commit) is held off, so rolling back means tagging
a new, higher release. A release that restarts but never answers is recorded as
failed in `/var/lib/rdc-skills-update/failed`, the proved release is served again,
and the failed one is not retried until a newer tag exists. An install or restart
error says nothing about the release: the proved release is served again and the
new one is retried next run. A registry that cannot be reached is not counted
unless it stays unreachable for that release for a whole day; any other install or
restart error, the third time against the same release, marks it failed. To retry a release marked failed without tagging again, delete its line
from that file on the host. A host with no history adopts the commit it is already
serving (if that commit is on `master`) as the proved release before touching
anything, so the first move has somewhere to go back to. Tracked changes on the
host, or a commit made on the host, are refused and the service is left as it is.
So pushing the tag is the whole public MCP deploy — expect it live within about
five minutes:

```bash
tag=v$(node -p "require('./package.json').version")
curl -fsS https://rdc-skills.regendevcorp.com/health   # git_sha == the line below
git rev-list -n 1 "$tag"
# on the host: journalctl -u rdc-skills-mcp-update.service -n 20
```

`install-systemd.sh` is the one-time host bootstrap. It installs the units and the
updater, runs the updater once (which restarts the MCP onto the checked-out release
and proves it), then enables the timer:

```bash
cd /srv/regen/rdc-skills
git fetch --tags origin && git merge --ff-only v<X.Y.Z>
sudo ./deploy/install-systemd.sh
```

Before the timer existed the checkout moved only when someone logged in and
pulled, and the public catalog sat on 0.35.18 through six releases.

Port `3110` is reserved for this public MCP ingress. Application fleet manifests
must not claim it.

## Version policy

- patch: skill fix, manifest update, or nonbreaking installer change
- minor: new capability or breaking skill interface
- major: distribution or runtime architecture change
