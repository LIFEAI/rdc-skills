#!/usr/bin/env node
'use strict';
/**
 * scripts/postinstall.js — runs after `npm install -g @lifeaitools/rdc-skills`.
 *
 * Self-registers this package's `clauth-plugin.json` with the local clauth
 * supervisor so an install is the registration. `@lifeaitools/rdc-skills` is
 * the only MCP besides clauth itself that is npm-published, so it is the only
 * one that can use npm's `postinstall` lifecycle this way; the unpublished
 * Docker/Coolify MCPs are covered by a repo-side sweep instead.
 *
 * ⛔ THE LOAD-BEARING PROPERTY: this file can never fail an install.
 * It mirrors `C:/Dev/clauth/scripts/postinstall.js` — every failure path
 * downgrades to a printed one-line hint, nothing throws, and the entry point
 * ends in `main().catch(() => {})`. A missing, locked, or broken clauth must
 * never turn `npm i -g @lifeaitools/rdc-skills` into a failed install.
 *
 * `clauth plugin register` is DAEMON-FREE — it validates the manifest, writes
 * to the managed-plugin root, and re-runs discovery. A stopped daemon is not
 * an error case here; only "clauth binary missing" and "register returned
 * non-zero" are.
 *
 * Paths are anchored to the INSTALLED PACKAGE directory via `__dirname`, not
 * to `process.cwd()` — during a global install the cwd is not the package root.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const MANIFEST_NAME = 'clauth-plugin.json';
const CLAUTH_BIN = 'clauth';
const PROBE_TIMEOUT_MS = 15000;
const REGISTER_TIMEOUT_MS = 60000;
const SKIP_ENV = 'RDC_SKILLS_SKIP_CLAUTH_REGISTER';

/** Absolute path to the manifest, anchored to the package root — never to cwd. */
function manifestPath(packageRoot = PACKAGE_ROOT) {
  return path.join(packageRoot, MANIFEST_NAME);
}

/** The argv `clauth` is invoked with. Exported so tests assert it without spawning. */
function registerArgs(packageRoot = PACKAGE_ROOT) {
  return ['plugin', 'register', manifestPath(packageRoot)];
}

/** The copy/pasteable command a human runs to finish registration by hand. */
function manualCommand(packageRoot = PACKAGE_ROOT) {
  return `${CLAUTH_BIN} ${registerArgs(packageRoot).join(' ')}`;
}

/**
 * Windows npm shims are `clauth.cmd`, which Node refuses to spawn directly, so
 * the shell is required there — and that means quoting args ourselves.
 */
function shellQuote(arg) {
  return /[\s"&|<>^]/.test(arg) ? `"${String(arg).replace(/"/g, '\\"')}"` : arg;
}

function invokeClauth(args, timeout, spawn) {
  const useShell = process.platform === 'win32';
  return spawn(CLAUTH_BIN, useShell ? args.map(shellQuote) : args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    windowsHide: true,
    shell: useShell,
  });
}

/** True when a `clauth` on PATH answers `--version` cleanly. Never throws. */
function clauthAvailable(spawn) {
  try {
    const probe = invokeClauth(['--version'], PROBE_TIMEOUT_MS, spawn);
    return !probe.error && probe.status === 0;
  } catch {
    return false;
  }
}

/**
 * Register the manifest with the local clauth supervisor.
 * Returns a result object; NEVER throws, NEVER exits non-zero.
 */
function register({ packageRoot = PACKAGE_ROOT, spawn = spawnSync, log = console.log } = {}) {
  const hint = (message) => log(`  ${message}`);
  const manifest = manifestPath(packageRoot);

  if (process.env[SKIP_ENV]) {
    hint(`○ clauth plugin registration skipped (${SKIP_ENV} set)`);
    return { outcome: 'skipped' };
  }

  if (!fs.existsSync(manifest)) {
    hint(`! ${MANIFEST_NAME} not found at ${manifest} — nothing to register`);
    return { outcome: 'no-manifest' };
  }

  if (!clauthAvailable(spawn)) {
    hint(`○ clauth not found — register later with: ${manualCommand(packageRoot)}`);
    return { outcome: 'no-clauth' };
  }

  let result;
  try {
    result = invokeClauth(registerArgs(packageRoot), REGISTER_TIMEOUT_MS, spawn);
  } catch (err) {
    hint(`! clauth plugin register could not start (${err && err.message}) — retry with: ${manualCommand(packageRoot)}`);
    return { outcome: 'spawn-failed' };
  }

  if (result && !result.error && result.status === 0) {
    hint('✓ clauth plugin manifest registered (rdc-skills)');
    return { outcome: 'registered' };
  }

  const detail = ((result && (result.stderr || result.stdout)) || '').trim().split('\n')[0];
  hint(`! clauth plugin register failed${detail ? `: ${detail}` : ''} — retry with: ${manualCommand(packageRoot)}`);
  return { outcome: 'register-failed' };
}

async function main(options) {
  register(options);
}

module.exports = {
  MANIFEST_NAME,
  CLAUTH_BIN,
  SKIP_ENV,
  PACKAGE_ROOT,
  manifestPath,
  registerArgs,
  manualCommand,
  shellQuote,
  register,
  main,
};

if (require.main === module) {
  main().catch(() => {});
}
