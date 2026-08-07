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

The Vultr host checks out this repository at `/srv/regen/rdc-skills` — it runs
straight from the checkout (no `npm install`), so `/health`'s `git_sha` comes
from `bin/rdc-skills-mcp.mjs`'s runtime `git rev-parse HEAD` fallback, NOT a
stamped `git-sha.json` (that file is `.gitignore`d on purpose — it's a
pack-time-only artifact for npm-installed copies; see the comment above its
`.gitignore` entry). `install-systemd.sh` alone does not restart the running
process. After pulling `master`:

```bash
git pull --ff-only origin master
sudo ./deploy/install-systemd.sh        # re-verify/re-enable the unit config
sudo systemctl restart rdc-skills-mcp.service   # actually load the new commit
curl -fsS https://rdc-skills.regendevcorp.com/health   # confirm git_sha == new HEAD
```

Port `3110` is reserved for this public MCP ingress. Application fleet manifests
must not claim it.

## Version policy

- patch: skill fix, manifest update, or nonbreaking installer change
- minor: new capability or breaking skill interface
- major: distribution or runtime architecture change
