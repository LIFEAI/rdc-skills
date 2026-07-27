#!/usr/bin/env node
/**
 * Prove the INSTALLED hook tree can actually load.
 *
 * The source was fine, the npm tarball was fine, and only the copied result was
 * broken: copyHookFiles() was flat, so hooks/lib/ was never created at the
 * destination and require('./lib/box-lock') died MODULE_NOT_FOUND — a SessionStart
 * hook exiting non-zero with EMPTY stdout on every session, before its package
 * verification could run, so its own repair path could never recover it.
 *
 * File-presence checks in the repo would not have caught that. This replays the
 * real copy into a scratch dir and LOADS the result.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { copyHookFiles } = require(path.join(ROOT, 'scripts', 'install-rdc-skills.js'));

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};

const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-hooks-install-'));
const count = copyHookFiles(path.join(ROOT, 'hooks'), dst);
check(`copied hook files (${count})`, count > 0);

// The exact loss: a nested dir the flat copy skipped.
check('hooks/lib/ exists at destination', fs.existsSync(path.join(dst, 'lib')));
check('hooks/lib/box-lock.js copied', fs.existsSync(path.join(dst, 'lib', 'box-lock.js')));
check('hooks/lib/run-evidence-gate.mjs copied (.mjs was filtered out too)',
  fs.existsSync(path.join(dst, 'lib', 'run-evidence-gate.mjs')));

// Load every top-level hook for real. --check only parses; it does not resolve
// require(), which is precisely what broke.
const hooks = fs.readdirSync(dst).filter((f) => f.endsWith('.js'));
const unresolved = [];
for (const h of hooks) {
  const entry = path.join(dst, h).replace(/\\/g, '/');
  const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)})`], {
    encoding: 'utf8', input: '', timeout: 20000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  if (/MODULE_NOT_FOUND|Cannot find module/.test(out)) {
    unresolved.push(`${h}: ${(out.match(/Cannot find module '[^']+'/) || [''])[0]}`);
  }
}
check(`all ${hooks.length} installed hooks resolve their imports`, unresolved.length === 0,
  unresolved.slice(0, 3).join(' | '));

fs.rmSync(dst, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILURE(S)` : '\ninstalled hook tree loads cleanly');
process.exit(fail ? 1 : 0);
