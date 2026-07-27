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

# 2. Bump the version
npm version patch|minor|major --no-git-tag-version

# 3. Commit, tag, and push
git add package.json package-lock.json
git commit -m "release: v$(node -e \"console.log(require('./package.json').version)\")"
git tag "v$(node -e \"console.log(require('./package.json').version)\")"
git push origin master --tags

# 4. Publish through the tag-triggered GitHub workflow

# 5. Verify the published package
npm view @lifeaitools/rdc-skills version
npm install -g @lifeaitools/rdc-skills@latest
npm list -g @lifeaitools/rdc-skills --depth=0
rdc-skills-self-test
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

The Vultr host checks out this repository at `/srv/regen/rdc-skills`. Install or
refresh its standalone systemd unit after pulling `master`:

```bash
sudo ./deploy/install-systemd.sh
```

Port `3110` is reserved for this public MCP ingress. Application fleet manifests
must not claim it.

## Version policy

- patch: skill fix, manifest update, or nonbreaking installer change
- minor: new capability or breaking skill interface
- major: distribution or runtime architecture change
