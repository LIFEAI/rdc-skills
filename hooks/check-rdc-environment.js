#!/usr/bin/env node
/**
 * SessionStart hook — hard gate for the RDC skills runtime.
 *
 * This hook repairs the approved install path when it can do so safely:
 *   npm install -g @lifeaitools/rdc-skills@latest
 *   rdc-skills-install --profile lifeai --project-root <repo> --write-startup-blocks
 *
 * It then verifies that the local MCP server answers /health and sees a real
 * skills catalog. If repair fails, startup is blocked before agents trust stale
 * copied skill files.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const hookLog = require('./hook-logger');

const MIN_SKILLS = 20;
const MCP_HEALTH = 'http://127.0.0.1:3110/health';
const PACKAGE = '@lifeaitools/rdc-skills';
const stampPath = path.join(os.tmpdir(), 'rdc-skills-environment-last-repair.json');

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

async function health() {
  try {
    const res = await fetch(MCP_HEALTH, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
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

/**
 * PM2 processes running FROM the global package directory.
 *
 * `npm install -g` upgrades by RENAMING that directory. On Windows a directory
 * that is a live process's cwd cannot be renamed, so the install dies EBUSY —
 * which is exactly what happened here: `rdc-skills-mcp` runs with
 * pm_cwd = <npm root>/@lifeaitools/rdc-skills, the very path npm moves.
 *
 * Matched by CWD rather than by name so a renamed or duplicated process is still
 * found — the lock is held by whatever sits in that directory, not by a name.
 */
function processesHoldingPackage() {
  if (!commandExists('pm2')) return [];
  try {
    const root = shell('npm root -g', { timeout: 10000 });
    const pkgDir = path.join(root, '@lifeaitools', 'rdc-skills').toLowerCase().replace(/\\/g, '/');
    return JSON.parse(shell('pm2 jlist', { timeout: 15000 }))
      .filter((p) => {
        const cwd = String(p?.pm2_env?.pm_cwd || '').toLowerCase().replace(/\\/g, '/');
        return cwd && (cwd === pkgDir || cwd.startsWith(`${pkgDir}/`));
      })
      .map((p) => p.name)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function repair(reason) {
  hookLog('check-rdc-environment', 'SessionStart', 'repair', { reason });

  // Release the directory lock BEFORE npm touches it. Without this the repair
  // cannot succeed while the MCP is running — it fails EBUSY, block() fires, and
  // the session is hard-blocked by its own repair attempt.
  const holders = processesHoldingPackage();
  for (const name of holders) {
    try {
      shell(`pm2 stop ${q(name)}`, { timeout: 30000 });
      hookLog('check-rdc-environment', 'SessionStart', 'stopped-for-repair', { name });
    } catch {
      /* already stopped, or pm2 unavailable — the install will report the truth */
    }
  }

  try {
    shell(`npm install -g ${q(`${PACKAGE}@latest`)}`, { timeout: 120000 });
    shell(`rdc-skills-install --profile lifeai --project-root ${q(projectRoot())} --write-startup-blocks`, { timeout: 180000 });
    markRepaired(reason);
  } finally {
    // ALWAYS restart, even when the install threw. Leaving the MCP stopped would
    // turn a failed repair into a worse outage than the one being repaired.
    for (const name of holders) {
      try {
        shell(`pm2 restart ${q(name)}`, { timeout: 30000 });
      } catch {
        /* surfaced by the health re-check below */
      }
    }
  }
}

/**
 * ── The global package is BOX-WIDE; this hook is PER-SESSION ──────────────────
 *
 * Every session and every worktree runs this hook, but there is only ONE global
 * npm package and ONE rdc-skills-mcp on the machine. Without coordination, N
 * sessions starting together each independently conclude "unhealthy" and each run
 * `npm install -g` against the same directory — they fight, and on Windows they
 * fight over a directory a live process is sitting in.
 *
 * recentlyRepaired() did not prevent this: it gated the BLOCK path, not the REPAIR
 * path, so concurrent starts all saw "not recently repaired" and all installed.
 *
 * A box-wide resource gets a box-wide update: exactly one session performs it, the
 * rest wait for it and re-probe. Waiting is the correct behaviour for a follower —
 * the leader is already fixing the thing they would have fixed.
 */
const lockPath = path.join(os.tmpdir(), 'rdc-skills-environment-repair.lock');
const LOCK_STALE_MS = 5 * 60 * 1000;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM'; // exists but not ours to signal
  }
}

/** Atomically become the box's updater, or report that someone else already is. */
function acquireBoxLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
      // Reclaim a lock whose owner died or that outlived any plausible install.
      let stale = true;
      try {
        const held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        stale = !processAlive(Number(held.pid)) || Date.now() - Date.parse(held.ts) > LOCK_STALE_MS;
      } catch {
        stale = true; // unreadable lock is not a reason to wedge every session
      }
      if (!stale) return false;
      try { fs.unlinkSync(lockPath); } catch { return false; }
    }
  }
  return false;
}

function releaseBoxLock() {
  try { fs.unlinkSync(lockPath); } catch { /* best effort */ }
}

/** Wait for the session that owns the update to finish, re-probing health. */
async function waitForBoxRepair(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const h = await health();
    if (h && h.status === 'ok' && Number(h.skills || 0) >= MIN_SKILLS) return h;
    if (!fs.existsSync(lockPath)) break; // leader finished; take one last look
  }
  return health();
}

function block(message, details = {}) {
  hookLog('check-rdc-environment', 'SessionStart', 'block', { message, ...details });
  process.stdout.write(JSON.stringify({
    systemMessage:
      `HARD BLOCK — RDC skills environment is not healthy.\n\n` +
      `${message}\n\n` +
      `Do not proceed with RDC work until the approved install path is repaired.\n\n` +
      `STOP THE SERVER FIRST — npm upgrades by renaming the global package dir, and\n` +
      `Windows cannot rename a running process's cwd. Skipping this step is what\n` +
      `produces "EBUSY ... rename ... @lifeaitools/rdc-skills":\n\n` +
      `pm2 stop rdc-skills-mcp\n` +
      `npm install -g @lifeaitools/rdc-skills@latest\n` +
      `rdc-skills-install --profile lifeai --project-root ${projectRoot()} --write-startup-blocks\n` +
      `pm2 restart rdc-skills-mcp`
  }));
  process.exit(1);
}

async function main() {
  const initialPkg = globalPackageJson();
  const initialHealth = await health();
  const reasons = [];

  if (!initialPkg) reasons.push('global package missing');
  if (!commandExists('rdc-skills-install')) reasons.push('installer command missing');
  if (!initialHealth || initialHealth.status !== 'ok' || Number(initialHealth.skills || 0) < MIN_SKILLS) {
    reasons.push('local MCP health/catalog invalid');
  }

  if (reasons.length) {
    if (recentlyRepaired()) {
      block(`RDC skills still unhealthy after a recent repair attempt: ${reasons.join(', ')}`);
    }
    if (acquireBoxLock()) {
      // This session is the box's updater.
      try {
        repair(reasons.join(', '));
      } catch (err) {
        block(`Automatic RDC skills repair failed: ${err.message}`, { reasons });
      } finally {
        releaseBoxLock();
      }
    } else {
      // Another session owns the box-wide update. Racing it is what broke this.
      hookLog('check-rdc-environment', 'SessionStart', 'await-box-repair', { reasons });
      const h = await waitForBoxRepair();
      if (!h || h.status !== 'ok' || Number(h.skills || 0) < MIN_SKILLS) {
        block(
          'Another session is updating the box-wide rdc-skills install and it did not '
          + `become healthy in time. Reasons seen here: ${reasons.join(', ')}`,
          { reasons, waited: true },
        );
      }
    }
  }

  const finalPkg = globalPackageJson();
  const finalHealth = await health();
  if (!finalPkg) block('Global @lifeaitools/rdc-skills package is missing after repair.');
  if (!commandExists('rdc-skills-install')) block('rdc-skills-install is missing after repair.');
  if (!finalHealth || finalHealth.status !== 'ok' || Number(finalHealth.skills || 0) < MIN_SKILLS) {
    block(`rdc-skills MCP is unhealthy after repair. Health: ${JSON.stringify(finalHealth)}`);
  }

  hookLog('check-rdc-environment', 'SessionStart', 'pass', {
    version: finalPkg.version,
    mcpVersion: finalHealth.version,
    skills: finalHealth.skills,
  });
  process.exit(0);
}

main().catch((err) => block(`RDC skills environment check crashed: ${err.message}`));
