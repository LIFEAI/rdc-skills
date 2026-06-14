#!/usr/bin/env node
/**
 * stamp-git-sha.mjs — bake the current git HEAD into git-sha.json at pack/publish
 * time. The MCP server runs from the npm-installed copy (no .git), so it cannot
 * `git rev-parse` at runtime; this build-time stamp is how /health reports a
 * PROVABLE commit ("running artifact == this exact published commit"). Run from
 * `prepack`, so `npm pack`/`npm publish` (incl. the publish.yml CI job at the
 * tagged commit) embeds the right SHA. Never fails the build — writes 'unknown'
 * if git is unavailable (e.g. a tarball-only checkout).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let sha = 'unknown';
try {
  sha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  sha = process.env.RDC_SKILLS_GIT_SHA || 'unknown';
}
const out = path.join(root, 'git-sha.json');
writeFileSync(out, JSON.stringify({ sha }, null, 2) + '\n');
console.error(`[stamp-git-sha] wrote ${out} sha=${sha}`);
