#!/usr/bin/env node
/**
 * Cross-platform prepack steps.
 *
 * The validators are advisory in package builds; they report drift in the
 * LIFEAI publishing corpus, but they must not make `npm pack` fail on Windows
 * because cmd.exe does not provide a POSIX `true` command (the old
 * `... || true && ...` chain silently short-circuited under cmd.exe).
 *
 * stamp-git-sha bakes the current HEAD into git-sha.json so the MCP server can
 * report a PROVABLE running commit on /health even when it runs from the npm
 * install (no .git at runtime). It runs LAST and is required, not advisory.
 */

import { spawnSync } from 'node:child_process';

const advisory = [
  ['scripts/validate-publish-manifests.js', '--mode', 'warn'],
  ['scripts/validate-place-histories.js', '--mode', 'warn'],
];

for (const args of advisory) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) {
    console.warn(`[prepack] advisory check failed to launch: ${args[0]}: ${result.error.message}`);
  } else if (result.status !== 0) {
    console.warn(`[prepack] advisory check exited ${result.status}: ${args[0]}`);
  }
}

// Required: stamp the git SHA (never fails the build — writes 'unknown' if git is unavailable).
spawnSync(process.execPath, ['scripts/stamp-git-sha.mjs'], { stdio: 'inherit' });
