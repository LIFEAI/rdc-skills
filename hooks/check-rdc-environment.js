#!/usr/bin/env node
/**
 * SessionStart hook — verifies the locally installed RDC skill package.
 *
 * The public rdc-skills MCP is an independently hosted, stateless connector for
 * claude.ai and other MCP clients. It is not a Windows daemon and this hook
 * never starts, stops, probes, or installs a process manager.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const hookLog = require('./hook-logger');
const { acquireBoxLock, releaseBoxLock, LOCK_PATH: lockPath } = require('./lib/box-lock');

const PACKAGE = '@lifeaitools/rdc-skills';
const stampPath = path.join(os.tmpdir(), 'rdc-skills-environment-last-repair.json');
const SAFE_PATH = /^[A-Za-z0-9 :._\\/\-]+$/;

function q(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function run(command, args, opts = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeout || 30000,
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, ...(opts.env || {}) },
  }).trim();
}

function shell(command, opts = {}) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeout || 30000,
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, ...(opts.env || {}) },
  }).trim();
}

function commandExists(name) {
  try {
    if (process.platform === 'win32') run('where.exe', [name], { timeout: 5000 });
    else run('which', [name], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function projectRoot() {
  try {
    return shell('git rev-parse --show-toplevel', { timeout: 5000 });
  } catch {
    return process.cwd();
  }
}

function globalPackageJson() {
  try {
    const root = shell('npm root -g', { timeout: 10000 });
    const pkg = path.join(root, '@lifeaitools', 'rdc-skills', 'package.json');
    if (!fs.existsSync(pkg)) return null;
    return JSON.parse(fs.readFileSync(pkg, 'utf8'));
  } catch {
    return null;
  }
}

function recentlyRepaired() {
  try {
    const data = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    return Date.now() - Date.parse(data.ts) < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

function markRepaired(reason) {
  try {
    fs.writeFileSync(stampPath, JSON.stringify({ ts: new Date().toISOString(), reason }, null, 2));
  } catch {
    /* best effort */
  }
}

function repair(reason) {
  hookLog('check-rdc-environment', 'SessionStart', 'repair', { reason });
  shell(`npm install -g ${q(`${PACKAGE}@latest`)}`, { timeout: 120000 });
  const root = projectRoot();
  if (!SAFE_PATH.test(root)) {
    throw new Error(`refusing to shell out with an unsafe project root: ${root}`);
  }
  shell(`rdc-skills-install --profile lifeai --project-root ${q(root)} --write-startup-blocks`, {
    timeout: 180000,
  });
  markRepaired(reason);
}

function localReasons() {
  const reasons = [];
  if (!globalPackageJson()) reasons.push('global package missing');
  if (!commandExists('rdc-skills-install')) reasons.push('installer command missing');
  return reasons;
}

async function waitForBoxRepair(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (localReasons().length === 0) return;
    if (!fs.existsSync(lockPath)) break;
  }
}

function block(message, details = {}) {
  hookLog('check-rdc-environment', 'SessionStart', 'block', { message, ...details });
  process.stdout.write(JSON.stringify({
    systemMessage:
      `HARD BLOCK — RDC skills package is not healthy.\n\n` +
      `${message}\n\n` +
      `Repair the approved local package/plugin installation:\n\n` +
      `npm install -g @lifeaitools/rdc-skills@latest\n` +
      `rdc-skills-install --profile lifeai --project-root ${projectRoot()} --write-startup-blocks`,
  }));
  process.exit(1);
}

async function main() {
  const reasons = localReasons();
  if (reasons.length) {
    if (recentlyRepaired()) {
      block(`RDC skills still unhealthy after a recent repair attempt: ${reasons.join(', ')}`);
    }
    if (acquireBoxLock()) {
      let repairError = null;
      try {
        repair(reasons.join(', '));
      } catch (error) {
        repairError = error;
      } finally {
        releaseBoxLock();
      }
      if (repairError) {
        block(`Automatic RDC skills repair failed: ${repairError.message}`, { reasons });
      }
    } else {
      hookLog('check-rdc-environment', 'SessionStart', 'await-box-repair', { reasons });
      await waitForBoxRepair();
    }
  }

  const finalReasons = localReasons();
  if (finalReasons.length) {
    block(`RDC skills package is unhealthy after repair: ${finalReasons.join(', ')}`);
  }

  const pkg = globalPackageJson();
  hookLog('check-rdc-environment', 'SessionStart', 'pass', { version: pkg.version });
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => block(`RDC skills environment check crashed: ${error.message}`));
}

module.exports = { main, repair, localReasons };
