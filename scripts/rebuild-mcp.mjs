#!/usr/bin/env node
/**
 * scripts/rebuild-mcp.mjs — "build hook" for the rdc-skills MCP server.
 *
 * The server reads skills live from disk, so a skill edit is usually picked up
 * without a restart. This script exists to (a) bounce the PM2 process so any
 * in-memory module cache is dropped, and (b) assert the local /health endpoint
 * reports the current on-disk skill count — a fast smoke that the server is up
 * and seeing the same catalog this script does.
 *
 * Tolerant of a missing PM2: if pm2 is not installed/registered, it prints how
 * to start the server and exits 0. It never hard-fails the caller.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSkills } from '../lib/catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PM2_NAME = 'rdc-skills-mcp';
const PORT = parseInt(process.env.PORT || '3110', 10);
const BIN = path.join(REPO_ROOT, 'bin', 'rdc-skills-mcp.mjs');

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  \x1b[36m→\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m⚠\x1b[0m ${m}`);

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function pm2Available() {
  try {
    sh('pm2 -v');
    return true;
  } catch {
    return false;
  }
}

function pm2HasProcess() {
  try {
    const list = JSON.parse(sh('pm2 jlist'));
    return Array.isArray(list) && list.some((p) => p.name === PM2_NAME);
  } catch {
    return false;
  }
}

async function checkHealth(expectedSkills) {
  // Node 22 has global fetch.
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      warn(`/health returned HTTP ${res.status}`);
      return false;
    }
    const json = await res.json();
    if (json.skills === expectedSkills) {
      ok(`/health OK — skills=${json.skills} (matches disk), version=${json.version}`);
      return true;
    }
    warn(`/health skills=${json.skills} but disk has ${expectedSkills} — server may be stale`);
    return false;
  } catch (err) {
    warn(`/health unreachable on port ${PORT}: ${err?.message || err}`);
    return false;
  }
}

async function main() {
  const diskSkills = listSkills().length;
  info(`On-disk catalog: ${diskSkills} skill(s)`);

  if (!pm2Available()) {
    warn('pm2 not found — cannot bounce the MCP process.');
    info(`Start it manually:  PORT=${PORT} pm2 start ${BIN} --name ${PM2_NAME}`);
    info(`Or run directly:    PORT=${PORT} node ${BIN}`);
    process.exit(0);
  }

  if (pm2HasProcess()) {
    try {
      sh(`pm2 restart ${PM2_NAME} --update-env`);
      ok(`pm2 restart ${PM2_NAME}`);
    } catch (err) {
      warn(`pm2 restart failed: ${err?.message || err}`);
    }
  } else {
    info(`pm2 process '${PM2_NAME}' not registered.`);
    info(`Start it:  PORT=${PORT} pm2 start ${BIN} --name ${PM2_NAME}`);
    process.exit(0);
  }

  // Give the process a beat to bind, then probe /health (no long sleeps).
  await new Promise((r) => setTimeout(r, 1200));
  await checkHealth(diskSkills);
  process.exit(0);
}

main().catch((err) => {
  warn(`rebuild-mcp error (non-fatal): ${err?.message || err}`);
  process.exit(0);
});
