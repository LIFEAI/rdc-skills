# Release — @lifeaitools/rdc-skills

## Package
- **Registry:** npm `@lifeaitools/rdc-skills`
- **Repo:** `LIFEAI/rdc-skills` (standalone, not in regen-root monorepo)
- **Default branch:** `master`

## Release process

```bash
# 1. Merge feature branch to master
git checkout master && git pull origin master
git merge <feature-branch> --no-edit

# 2. Bump version
npm version patch|minor|major --no-git-tag-version

# 3. Commit + tag + push
git add package.json && git commit -m "release: v$(node -e \"console.log(require('./package.json').version)\")"
git tag "v$(node -e \"console.log(require('./package.json').version)\")"
git push origin master --tags

# 4. Publish to npm
npm publish

# 5. Install globally (serves both Claude Code CLI + MCP server)
npm install -g @lifeaitools/rdc-skills@latest

# 6. Refresh the MCP server and verify the catalog
pm2 restart rdc-skills-mcp --update-env
curl -s http://127.0.0.1:3110/health
curl -s https://rdc-skills.regendevcorp.com/health
REMOTE=1 node tests/mcp.test.mjs
REMOTE=1 node tests/curl-surface.test.mjs

# 7. Verify installed package
npm list -g @lifeaitools/rdc-skills --depth=0
```

## Automated via rdc:release

```
rdc:release rdc-skills --patch
```

This runs the package release flow. Before calling a release complete, also verify
that the MCP catalog has refreshed locally and at the public endpoint.

## Environment targets
- **Local dev:** `npm install -g` + PM2 `rdc-skills-mcp` process
- **Remote MCP:** PM2 on Vultr `64.237.54.189` (auto-deploys via webhook on push to master)
- **Production:** N/A (npm global install is the distribution mechanism)

## MCP release gate

Every release that changes skills, manifests, commands, guides, MCP server code,
or installer behavior must prove the running MCP serves the released package:

1. `npm view @lifeaitools/rdc-skills version` equals `package.json`.
2. Global install is updated with `npm install -g @lifeaitools/rdc-skills@latest`.
3. PM2 `rdc-skills-mcp` is restarted locally after the global install.
4. Local `/health` reports the released version and expected skill count.
5. Public `/health` at `https://rdc-skills.regendevcorp.com/health` reports the released version and expected skill count.
6. `REMOTE=1 node tests/mcp.test.mjs` and `REMOTE=1 node tests/curl-surface.test.mjs` pass against the public endpoint.

The installer also performs this update path in `scripts/install-rdc-skills.js`:
it registers the MCP endpoint, syncs the global MCP package when PM2 is serving
from npm, restarts `rdc-skills-mcp`, and verifies the live catalog freshness.

## Version policy
- patch: new skill, skill fix, manifest update
- minor: new capability, breaking skill interface change
- major: harness architecture change
