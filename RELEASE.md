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

# 6. Verify
npm list -g @lifeaitools/rdc-skills --depth=0
```

## Automated via rdc:release

```
rdc:release rdc-skills --patch
```

This runs steps 1–6 automatically.

## Environment targets
- **Local dev:** `npm install -g` + PM2 `rdc-skills-mcp` process
- **Remote MCP:** PM2 on Vultr `64.237.54.189` (auto-deploys via webhook on push to master)
- **Production:** N/A (npm global install is the distribution mechanism)

## Version policy
- patch: new skill, skill fix, manifest update
- minor: new capability, breaking skill interface change
- major: harness architecture change
