#!/usr/bin/env node
/**
 * Compatibility wrapper for the current rdc-skills validation gate.
 *
 * The older validator required every skill to use the same "When to Use" /
 * "Procedure" section shape. The canonical gate is now scripts/self-test.mjs,
 * which understands the shipped skill variants, guide checks, hook behavior,
 * plugin metadata, and strict warning policy.
 */

const { spawnSync } = require("node:child_process");
const { join, dirname } = require("node:path");

const repoRoot = dirname(dirname(__filename));
const selfTest = join(repoRoot, "scripts", "self-test.mjs");

const result = spawnSync(process.execPath, [selfTest, "--strict"], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

process.exit(result.status ?? 1);
