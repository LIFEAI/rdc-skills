#!/usr/bin/env node
/**
 * verify-live-install.mjs — proof, not hope.
 *
 * install-rdc-skills.js's "post-install verification" step only checks LOCAL
 * structural counts (cache dir count, installed_plugins entry count, orphan
 * cleanup) — it never asks any of the four surfaces a Claude/Codex session
 * actually reads from whether they are serving the CURRENT catalog. On
 * 2026-08-16 that gap was live: the production MCP endpoint answered
 * `{"skills":0,"version":"0.0.0"}` while origin/master carried 37 skills, and
 * nothing had ever noticed. This script is the missing check: it names a
 * SOURCE OF TRUTH (origin/master, fetched fresh — never local disk, which is
 * exactly what was stale) and asks each live surface to prove it matches.
 *
 * Surfaces checked (all four the installer registers):
 *   1. Claude CLI  — ~/.claude/plugins/installed_plugins.json + cache/latest/skills/
 *   2. Codex       — every skill dir the installer's findCodexTargets() would touch
 *   3. Claude MCP  — live GET <mcp-url>/health (shared endpoint, also what claude.ai uses)
 *   4. Codex MCP   — ~/.codex/config.toml points at the SAME endpoint checked in (3)
 *
 * Usage:
 *   node scripts/verify-live-install.mjs                  human table, exit 1 on any FAIL
 *   node scripts/verify-live-install.mjs --json            machine-readable
 *   node scripts/verify-live-install.mjs --mcp-url <url>   override (default: production)
 *   node scripts/verify-live-install.mjs --codex-root <dir> consuming project root
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const mcpUrlIdx = args.indexOf('--mcp-url');
const MCP_URL = mcpUrlIdx >= 0 ? args[mcpUrlIdx + 1] : 'https://rdc-skills.regendevcorp.com';
const codexRootIdx = args.indexOf('--codex-root');
const CODEX_ROOT = codexRootIdx >= 0 ? path.resolve(args[codexRootIdx + 1]) : null;

const installedRoot = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
// Tests and package consumers can supply an unpacked package root.  A global npm
// installation has no .git directory, so it must never be treated as a checkout.
const repoRoot = process.env.RDC_SKILLS_ROOT ? path.resolve(process.env.RDC_SKILLS_ROOT) : installedRoot;
const claudeHome = path.join(os.homedir(), '.claude');
const PLUGIN_KEY = 'rdc-skills@rdc-skills';

function readJson(p, fallback = {}) {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function readFrontmatterName(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const nm = m[1].match(/^name:\s*(.+)$/m);
    return nm ? nm[1].trim() : null;
  } catch { return null; }
}

function httpGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: true, status: res.statusCode, json: JSON.parse(body) }); }
        catch (e) { resolve({ ok: false, error: `bad JSON: ${e.message}`, raw: body.slice(0, 200) }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

function packagedTruth() {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  if (!pkg.version) throw new Error(`package.json version missing at ${repoRoot}`);
  const skillsRoot = path.join(repoRoot, 'skills');
  const skillCount = fs.existsSync(skillsRoot)
    ? fs.readdirSync(skillsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md'))).length
    : 0;
  return { sha: null, shortSha: 'package', version: pkg.version, skillCount, authority: 'installed npm package' };
}

// ── Source of truth — origin/master when this is a checkout, otherwise the
// installed npm package. A global npm install is intentionally not a Git repo;
// requiring `git fetch` there made every successful install emit a false error.
// Checkout mode remains fresh-remote authoritative to catch stale source trees.
// ───────────────────────────────────────────────────────────────────────────
function sourceOfTruth() {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) return packagedTruth();
  execSync('git fetch origin master', { cwd: repoRoot, stdio: 'pipe' });
  const sha = execSync('git rev-parse origin/master', { cwd: repoRoot, encoding: 'utf8' }).trim();
  const pkgRaw = execSync('git show origin/master:package.json', { cwd: repoRoot, encoding: 'utf8' });
  const version = JSON.parse(pkgRaw).version;
  const skillDirs = execSync('git ls-tree -d --name-only origin/master:skills', { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  // Only count dirs that actually carry a SKILL.md at that ref — matches what
  // the installer/MCP catalog treat as a real skill, not a stray directory.
  let skillCount = 0;
  for (const d of skillDirs) {
    try {
      execSync(`git cat-file -e origin/master:skills/${d}/SKILL.md`, { cwd: repoRoot, stdio: 'pipe' });
      skillCount++;
    } catch { /* not a real skill dir */ }
  }
  return { sha, shortSha: sha.slice(0, 7), version, skillCount, authority: 'origin/master' };
}

if (args.includes('--self-test-source-of-truth')) {
  console.log(JSON.stringify(sourceOfTruth()));
  process.exit(0);
}

// ── Surface 1: Claude CLI ────────────────────────────────────────────────────
function checkClaudeCli(truth) {
  const ipPath = path.join(claudeHome, 'plugins', 'installed_plugins.json');
  const installed = readJson(ipPath, { plugins: {} });
  const entries = installed.plugins[PLUGIN_KEY] || [];
  if (entries.length !== 1) {
    return { surface: 'Claude CLI', pass: false, detail: `expected 1 installed_plugins entry, found ${entries.length}` };
  }
  const entry = entries[0];
  const cacheSkillsDir = entry.installPath ? path.join(entry.installPath, 'skills') : null;
  const cacheCount = cacheSkillsDir && fs.existsSync(cacheSkillsDir)
    ? fs.readdirSync(cacheSkillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(cacheSkillsDir, e.name, 'SKILL.md'))).length
    : -1;
  const shaMatch = !truth.sha || entry.gitCommitSha === truth.sha;
  const versionMatch = entry.version === truth.version;
  const countMatch = cacheCount === truth.skillCount;
  const pass = shaMatch && versionMatch && countMatch;
  return {
    surface: 'Claude CLI',
    pass,
    detail: pass
      ? `v${entry.version} @ ${truth.shortSha}, ${cacheCount} skills — matches ${truth.authority}`
      : `v${entry.version || '?'} @ ${(entry.gitCommitSha || '?').slice(0, 7)}, ${cacheCount} skills`
        + ` — expected v${truth.version} @ ${truth.shortSha}, ${truth.skillCount} skills`
        + `${shaMatch ? '' : ' [SHA MISMATCH]'}${versionMatch ? '' : ' [VERSION MISMATCH]'}${countMatch ? '' : ' [COUNT MISMATCH]'}`,
  };
}

// ── Surface 2: Codex (MCP-only; no stale file-based skill dirs) ─────────────
function findCodexTargets(codexRoot) {
  const targets = [];
  const add = (label, dir) => {
    if (dir && fs.existsSync(dir) && !targets.some((t) => t.dir.toLowerCase() === dir.toLowerCase())) {
      targets.push({ label, dir });
    }
  };
  if (codexRoot) add('project .agents', path.join(codexRoot, '.agents', 'skills', 'user'));
  add('global .codex', path.join(os.homedir(), '.codex', 'skills'));
  add('global .agents', path.join(os.homedir(), '.agents', 'skills'));
  return targets;
}

function checkCodex(truth) {
  const codexRootCandidates = [
    CODEX_ROOT,
    process.env.REGEN_ROOT ? path.resolve(process.env.REGEN_ROOT) : null,
    path.resolve(repoRoot, '..', 'regen-root'),
    process.cwd(),
  ].filter(Boolean);
  const codexRoot = codexRootCandidates.find((c) => fs.existsSync(path.join(c, '.agents')));
  const targets = findCodexTargets(codexRoot);
  if (targets.length === 0) {
    return { surface: 'Codex', pass: false, detail: 'no Codex skill directories found on this machine — install never ran with a Codex target' };
  }
  const results = [];
  for (const t of targets) {
    const dirs = fs.readdirSync(t.dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const rdcDirs = dirs.filter((e) => /^rdc-/.test(e.name) || readFrontmatterName(path.join(t.dir, e.name, 'SKILL.md'))?.startsWith('rdc:'));
    results.push({ label: t.label, dir: t.dir, count: rdcDirs.length });
  }
  const pass = results.every((r) => r.count === 0);
  const detail = results.map((r) =>
    `${r.label}: ${r.count} legacy file-based rdc skill(s)${r.count === 0 ? '' : ' [MCP DUPLICATES PRESENT]'}`
  ).join('; ');
  return { surface: 'Codex', pass, detail };
}

// ── Surface 3: Claude MCP (live) ─────────────────────────────────────────────
async function checkClaudeMcp(truth) {
  const res = await httpGetJson(`${MCP_URL}/health`);
  if (!res.ok) {
    return { surface: 'Claude MCP', pass: false, detail: `${MCP_URL}/health unreachable — ${res.error}` };
  }
  const { skills, git_sha, version, status } = res.json;
  const shaMatch = !truth.sha || git_sha === truth.sha;
  const countMatch = skills === truth.skillCount;
  const versionMatch = version === truth.version;
  const pass = status === 'ok' && shaMatch && versionMatch && countMatch;
  return {
    surface: 'Claude MCP',
    pass,
    detail: pass
      ? `${MCP_URL}/health — v${version}, ${skills} skills @ ${truth.shortSha} — matches ${truth.authority}`
      : `${MCP_URL}/health — status=${status} v${version} skills=${skills} sha=${(git_sha || '?').slice(0, 7)}`
        + ` — expected v${truth.version}, ${truth.skillCount} skills @ ${truth.shortSha}`
        + `${shaMatch ? '' : ' [SHA MISMATCH]'}${versionMatch ? '' : ' [VERSION MISMATCH]'}${countMatch ? '' : ' [COUNT MISMATCH]'}`,
  };
}

// ── Surface 4: Codex MCP config points at the same live endpoint ───────────
function checkCodexMcpConfig() {
  const codexToml = path.join(os.homedir(), '.codex', 'config.toml');
  if (!fs.existsSync(codexToml)) {
    return { surface: 'Codex MCP', pass: false, detail: `${codexToml} does not exist` };
  }
  const toml = fs.readFileSync(codexToml, 'utf8').replace(/\r\n/g, '\n');
  const blockRe = /\[mcp_servers\.rdc-skills\]\n([\s\S]*?)(?=\n\[|\s*$)/;
  const m = toml.match(blockRe);
  if (!m) return { surface: 'Codex MCP', pass: false, detail: 'no [mcp_servers.rdc-skills] block in config.toml' };
  const urlM = m[1].match(/^url\s*=\s*'([^']+)'/m);
  const configuredUrl = urlM ? urlM[1] : null;
  const pass = configuredUrl === `${MCP_URL}/mcp`;
  return {
    surface: 'Codex MCP',
    pass,
    detail: pass
      ? `config.toml points at ${configuredUrl} — same live endpoint verified above`
      : `config.toml url=${configuredUrl || 'MISSING'} — expected ${MCP_URL}/mcp`,
  };
}

async function main() {
  const truth = sourceOfTruth();
  const rows = [];
  rows.push(checkClaudeCli(truth));
  rows.push(checkCodex(truth));
  rows.push(await checkClaudeMcp(truth));
  rows.push(checkCodexMcpConfig());

  const allPass = rows.every((r) => r.pass);

  if (asJson) {
    console.log(JSON.stringify({ truth, rows, allPass }, null, 2));
  } else {
    console.log('');
    console.log(`  Source of truth: ${truth.authority} @ ${truth.shortSha}, v${truth.version}, ${truth.skillCount} skills`);
    console.log('');
    for (const r of rows) {
      const mark = r.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`  ${mark} ${r.surface.padEnd(12)} ${r.detail}`);
    }
    console.log('');
    console.log(allPass
      ? '  \x1b[32mAll surfaces verified live — proof, not assumption.\x1b[0m'
      : '  \x1b[31mAt least one surface does NOT match origin/master. This is the exact blind spot install-rdc-skills.js does not check.\x1b[0m');
    console.log('');
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(2); });
