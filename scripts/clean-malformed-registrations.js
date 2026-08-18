#!/usr/bin/env node
/**
 * clean-malformed-registrations — find (and optionally remove) rdc-skills
 * registrations that are malformed or duplicated on an already-installed box.
 *
 * DRY RUN BY DEFAULT. Nothing is deleted unless you pass --apply.
 *
 *   node scripts/clean-malformed-registrations.mjs                 # report only
 *   node scripts/clean-malformed-registrations.mjs --apply         # remove
 *   node scripts/clean-malformed-registrations.mjs --project-root C:/Dev/regen-root
 *
 * What "malformed" means here
 * ---------------------------
 * `.claude-plugin/plugin.json` declares `name: "rdc"`, and Claude Code registers
 * a plugin component as `<plugin>:<declared frontmatter name>`. A component whose
 * own `name:` already spells the namespace gets it twice — `name: rdc:plan`
 * renders `/rdc:rdc:plan`, and a directory called `rdc-brochurify` renders
 * `rdc:rdc-brochurify`.
 *
 * Two independent defects produce what the operator sees, and this script
 * separates them because the remedies differ:
 *
 *   PREFIXING     — a component declares the namespace itself. Fixed at the
 *                   source (this repo). An installed copy carrying it is simply
 *                   an old build: re-run the installer.
 *   MULTIPLICATION— the same component is registered from more than one live
 *                   source at once (extra plugin-cache dirs, a stale marketplace
 *                   clone that is a full second copy of commands/ + skills/,
 *                   leftover skills/user orphans). Re-running the installer does
 *                   not always clear these, which is what this script is for.
 *
 * Safety: only regenerable install artifacts are ever removed. The marketplace
 * directory is a git clone — it is REPORTED with the exact command, never
 * deleted, because destroying it loses nothing but confuses Claude Code's own
 * marketplace sync.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const CLAUDE_HOME = path.resolve(argOf('--claude-home', path.join(os.homedir(), '.claude')));
const PROJECT_ROOT = argOf('--project-root', null);
const MARKETPLACE = 'rdc-skills';

// The namespace is read from the installed plugin manifest when available, so
// this script stays correct if the plugin is ever renamed.
function pluginNamespace() {
  const candidates = [
    path.join(CLAUDE_HOME, 'plugins', 'cache', MARKETPLACE, 'rdc-skills', 'latest', '.claude-plugin', 'plugin.json'),
    path.resolve(__dirname, '..', '.claude-plugin', 'plugin.json'),
  ];
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).name; } catch {}
  }
  return 'rdc';
}
const NS = pluginNamespace();

const findings = { prefixing: [], multiplication: [], report: [] };
const removals = []; // { path, why, kind: 'dir' | 'file' }

function declaredName(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const block = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!block) return null;
    const line = block[1].split('\n').find((l) => /^name:\s*/.test(l));
    return line ? line.replace(/^name:\s*/, '').trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}

function isDoubled(effective) {
  return effective === NS || effective.startsWith(`${NS}:`) || effective.startsWith(`${NS}-`);
}

/** Scan one installed plugin tree (commands/ + skills/) for doubled names. */
function scanTree(label, treeDir) {
  if (!fs.existsSync(treeDir)) return;

  const cmdDir = path.join(treeDir, 'commands');
  if (fs.existsSync(cmdDir)) {
    for (const f of fs.readdirSync(cmdDir).filter((f) => f.endsWith('.md')).sort()) {
      const eff = declaredName(path.join(cmdDir, f)) ?? f.replace(/\.md$/, '');
      if (isDoubled(eff)) {
        findings.prefixing.push({ source: label, file: path.join(cmdDir, f), declared: eff, renders: `${NS}:${eff}` });
      }
    }
  }

  const skillsDir = path.join(treeDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory()) continue;
      const md = path.join(skillsDir, e.name, 'SKILL.md');
      if (!fs.existsSync(md)) continue;
      const eff = declaredName(md) ?? e.name;
      if (isDoubled(eff)) {
        findings.prefixing.push({ source: label, file: md, declared: eff, renders: `${NS}:${eff}` });
      }
    }
  }
}

// ── 1. Every live plugin source ───────────────────────────────────────────────
const pluginsDir = path.join(CLAUDE_HOME, 'plugins');
const cacheBase = path.join(pluginsDir, 'cache', MARKETPLACE, 'rdc-skills');
const mktDir = path.join(pluginsDir, 'marketplaces', MARKETPLACE);

if (fs.existsSync(cacheBase)) {
  for (const entry of fs.readdirSync(cacheBase)) {
    scanTree(`cache/${entry}`, path.join(cacheBase, entry));
    if (entry !== 'latest') {
      findings.multiplication.push(`extra plugin cache dir registers a second full copy: cache/${entry}`);
      removals.push({ path: path.join(cacheBase, entry), why: 'non-latest plugin cache dir (duplicate source)', kind: 'dir' });
    }
  }
}

// The marketplace directory is a git CLONE of the whole repo, not just a
// manifest. When it lags, it is a second, older copy of every command and skill,
// live in the menu beside the current one. Never deleted here.
if (fs.existsSync(mktDir)) {
  scanTree('marketplaces/rdc-skills', mktDir);
  const hasTree = fs.existsSync(path.join(mktDir, 'commands')) || fs.existsSync(path.join(mktDir, 'skills'));
  if (hasTree) {
    findings.multiplication.push('marketplace dir contains a full commands/ + skills/ tree — a second live source');
    findings.report.push(
      `Marketplace clone is a second source. Bring it to the shipping ref (do NOT delete it):\n` +
      `      git -C "${mktDir}" fetch origin master\n` +
      `      git -C "${mktDir}" status --porcelain     # must be empty first\n` +
      `      git -C "${mktDir}" reset --hard origin/master`
    );
  }
}

// ── 2. skills/ and skills/user/ orphans ───────────────────────────────────────
for (const rel of ['skills', path.join('skills', 'user')]) {
  const dir = path.join(CLAUDE_HOME, rel);
  if (!fs.existsSync(dir)) continue;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    let md = null;
    if (e.isDirectory()) {
      md = ['SKILL.md', 'skill.md'].map((n) => path.join(p, n)).find((f) => fs.existsSync(f)) || null;
    } else if (e.name.endsWith('.md')) {
      md = p;
    }
    if (!md) continue;
    const name = declaredName(md);
    if (name && (name === NS || name.startsWith(`${NS}:`) || name.startsWith(`${NS}-`))) {
      findings.multiplication.push(`loose skill in ${rel}/ shadows the plugin copy: ${e.name} (declares "${name}")`);
      removals.push({ path: p, why: `loose rdc skill under ${rel}/ (plugin cache is authoritative)`, kind: e.isDirectory() ? 'dir' : 'file' });
    }
  }
}

// ── 3. Codex / .agents skill dirs — stale rdc-* copies ────────────────────────
const codexTargets = [
  path.join(os.homedir(), '.codex', 'skills'),
  path.join(os.homedir(), '.agents', 'skills'),
  PROJECT_ROOT ? path.join(path.resolve(PROJECT_ROOT), '.agents', 'skills', 'user') : null,
].filter(Boolean);

for (const target of codexTargets) {
  if (!fs.existsSync(target)) continue;
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    if (!e.isDirectory() || !new RegExp(`^${NS}-`).test(e.name)) continue;
    const p = path.join(target, e.name);
    findings.multiplication.push(`stale codex skill copy: ${p}`);
    removals.push({ path: p, why: 'legacy rdc-<name>/ codex skill copy (superseded by MCP)', kind: 'dir' });
  }
}

// ── 4. Duplicate plugin registration rows ─────────────────────────────────────
function jsonKeysStartingWithRdc(file, pick) {
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bag = pick(data) || {};
    return Object.keys(bag).filter((k) => k.startsWith('rdc-skills@'));
  } catch { return []; }
}
const ipKeys = jsonKeysStartingWithRdc(path.join(pluginsDir, 'installed_plugins.json'), (d) => d.plugins);
if (ipKeys.length > 1) {
  findings.multiplication.push(`installed_plugins.json has ${ipKeys.length} rdc-skills keys: ${ipKeys.join(', ')}`);
  findings.report.push('Re-run `node scripts/install-rdc-skills.js` — it collapses these to one row.');
}
const spKeys = jsonKeysStartingWithRdc(path.join(CLAUDE_HOME, 'settings.json'), (d) => d.enabledPlugins);
if (spKeys.length > 1) {
  findings.multiplication.push(`settings.json enabledPlugins has ${spKeys.length} rdc-skills keys: ${spKeys.join(', ')}`);
  findings.report.push('Re-run `node scripts/install-rdc-skills.js` — it collapses these to one key.');
}

// ── Output ────────────────────────────────────────────────────────────────────
const B = (s) => `\x1b[1m${s}\x1b[0m`;
console.log('');
console.log(B(`rdc-skills malformed-registration scan   namespace="${NS}"   home=${CLAUDE_HOME}`));
console.log(APPLY ? '  MODE: APPLY (will remove)' : '  MODE: DRY RUN (nothing will be removed — pass --apply to act)');
console.log('');

console.log(B(`A. PREFIXING — components that spell "${NS}" twice  (${findings.prefixing.length})`));
if (!findings.prefixing.length) console.log('   none');
for (const f of findings.prefixing) {
  console.log(`   [${f.source}] ${f.declared}  ->  registers as ${f.renders}`);
  console.log(`      ${f.file}`);
}
console.log('');
console.log('   Remedy: these are stale BUILDS, not stray files — fixing them by hand');
console.log('   would be overwritten on the next install. Update the source package and');
console.log('   re-run the installer:  npm i -g @lifeaitools/rdc-skills && rdc-skills-install');
console.log('');

console.log(B(`B. MULTIPLICATION — the same component registered from >1 source  (${findings.multiplication.length})`));
if (!findings.multiplication.length) console.log('   none');
for (const m of findings.multiplication) console.log(`   ${m}`);
console.log('');

console.log(B(`REMOVABLE ARTIFACTS  (${removals.length})`));
if (!removals.length) console.log('   none');
for (const r of removals) console.log(`   ${r.kind.padEnd(4)} ${r.path}\n        why: ${r.why}`);
console.log('');

if (findings.report.length) {
  console.log(B('MANUAL STEPS (not removable by this script)'));
  for (const r of findings.report) console.log(`   - ${r}`);
  console.log('');
}

if (!APPLY) {
  console.log(B('DRY RUN — nothing was removed.'));
  console.log(`  Re-run with --apply to remove the ${removals.length} artifact(s) listed above.`);
  console.log('');
  process.exit(0);
}

let removed = 0;
for (const r of removals) {
  try {
    fs.rmSync(r.path, { recursive: r.kind === 'dir', force: true });
    console.log(`  removed ${r.path}`);
    removed++;
  } catch (e) {
    console.log(`  FAILED  ${r.path} — ${e.message}`);
  }
}
console.log('');
console.log(`  removed ${removed}/${removals.length} artifact(s).`);
console.log('  Now re-run the installer so the single authoritative copy is rebuilt:');
console.log('    node scripts/install-rdc-skills.js');
console.log('');
