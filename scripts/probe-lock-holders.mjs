#!/usr/bin/env node
/**
 * Read-only probe: which PM2 processes hold the global rdc-skills package dir?
 *
 * Mirrors processesHoldingPackage() in hooks/check-rdc-environment.js so the
 * matcher can be verified WITHOUT running a real repair (which would stop the
 * MCP and reinstall the package).
 *
 * `npm install -g` upgrades by renaming that directory; Windows refuses to rename
 * a live process's cwd, which is the EBUSY that hard-blocked sessions.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

const shell = (c) => execSync(c, { encoding: 'utf8', timeout: 15000 }).trim();
const norm = (p) => String(p || '').toLowerCase().replace(/\\/g, '/');

const root = shell('npm root -g');
const pkgDir = norm(path.join(root, '@lifeaitools', 'rdc-skills'));

const all = JSON.parse(shell('pm2 jlist'));
const holders = all.filter((p) => {
  const cwd = norm(p?.pm2_env?.pm_cwd);
  return cwd && (cwd === pkgDir || cwd.startsWith(`${pkgDir}/`));
});

console.log(`package dir : ${pkgDir}`);
console.log(`pm2 procs   : ${all.length}`);
for (const p of holders) {
  console.log(`  HOLDS LOCK: ${p.name}  status=${p.pm2_env.status}  cwd=${norm(p.pm2_env.pm_cwd)}`);
}
console.log(
  holders.length
    ? `\nMATCHED ${holders.length} — these are stopped before npm -g, so EBUSY is avoided.`
    : '\nNO MATCH — nothing holds the dir; npm -g would have been safe anyway.',
);
