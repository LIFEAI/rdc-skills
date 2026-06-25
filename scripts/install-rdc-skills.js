#!/usr/bin/env node
/**
 * install-rdc-skills — registers rdc-skills on every Claude surface.
 *
 * Usage:
 *   node scripts/install-rdc-skills.js                      ← standard
 *   node scripts/install-rdc-skills.js --skip-hooks         ← skip hook wiring
 *   node scripts/install-rdc-skills.js --profile core       ← clean-box portable hooks
 *   node scripts/install-rdc-skills.js --profile lifeai     ← LIFEAI/regen-root hooks
 *   node scripts/install-rdc-skills.js --claude-home <path> ← custom CLI home
 *   node scripts/install-rdc-skills.js --codex-root <path>  ← also install to .agents/skills/user/
 *   node scripts/install-rdc-skills.js --codex-skill-dir <path> ← also install to a Codex skill dir
 *   node scripts/install-rdc-skills.js --project-root <path> --write-startup-blocks
 *   node scripts/install-rdc-skills.js --migrate <path>     ← migrate docs/ → .rdc/
 *
 * What it does:
 *   1. git pull (latest commands + guides)
 *   2. CLI plugin  — registers in ~/.claude/plugins/ + settings.json
 *   3. Cowork      — registers in Desktop cowork_plugins/ + cowork_settings.json
 *   3.5 Codex      — copies skills to detected Codex skill dirs
 *   4. Hook files  — copies hooks/*.js → ~/.claude/hooks/
 *   5. Hook wiring — wires hooks into ~/.claude/settings.json
 *   6. Zip         — builds dist/rdc-skills-plugin.zip for claude.ai / distribution
 *   7. Preflight   — Node version, clauth daemon
 *   8. Commands    — lists all /rdc:* commands
 */

'use strict';
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const readline     = require('readline');
const { execSync } = require('child_process');

// ── Args ──────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const skipHooks  = args.includes('--skip-hooks');
const profileIdx = args.indexOf('--profile');
const profileArg = profileIdx >= 0 ? String(args[profileIdx + 1] || '').toLowerCase() : 'auto';
const homeIdx    = args.indexOf('--claude-home');
const claudeHome = homeIdx >= 0 ? args[homeIdx + 1] : path.join(os.homedir(), '.claude');
const migrateIdx = args.indexOf('--migrate');
const doMigrate  = migrateIdx >= 0;
const migratePath = doMigrate ? (args[migrateIdx + 1] || process.cwd()) : null;
const projectIdx = args.indexOf('--project-root');
const projectRootArg = projectIdx >= 0 ? path.resolve(args[projectIdx + 1]) : null;
const shouldWriteStartupBlocks = args.includes('--write-startup-blocks');

const repoRoot     = path.resolve(__dirname, '..');

const codexIdx   = args.indexOf('--codex-root');
const codexRoot  = codexIdx >= 0
  ? path.resolve(args[codexIdx + 1])
  : (() => {
      // Auto-detect the consuming project's .agents tree so a plain `install`
      // refreshes Codex without needing --codex-root. Check, in order: an
      // explicit --project-root, the current working directory, then the
      // regen-root sibling of this repo. First one with a `.agents` wins.
      const candidates = [
        projectRootArg ? path.resolve(projectRootArg) : null,
        process.cwd(),
        path.resolve(repoRoot, '..', 'regen-root'),
      ].filter(Boolean);
      for (const c of candidates) {
        if (fs.existsSync(path.join(c, '.agents'))) return c;
      }
      return null;
    })();
const codexSkillDirIdx = args.indexOf('--codex-skill-dir');
const explicitCodexSkillDir = codexSkillDirIdx >= 0
  ? path.resolve(args[codexSkillDirIdx + 1])
  : null;
const hooksSrc     = path.join(repoRoot, 'hooks');
const hooksDst     = path.join(claudeHome, 'hooks');
const settingsPath = path.join(claudeHome, 'settings.json');
const detectedLifeaiRoot = (() => {
  const sibling = path.resolve(repoRoot, '..', 'regen-root');
  return fs.existsSync(path.join(sibling, 'CLAUDE.md')) && fs.existsSync(path.join(sibling, '.rdc')) ? sibling : null;
})();
const installProfile = (() => {
  if (profileArg === 'core' || profileArg === 'lifeai') return profileArg;
  if (profileArg !== 'auto') {
    console.log(`  \x1b[33m⚠\x1b[0m Unknown --profile "${profileArg}" — using auto`);
  }
  return detectedLifeaiRoot ? 'lifeai' : 'core';
})();
const projectRoot = projectRootArg || codexRoot || detectedLifeaiRoot;

const PLUGIN_KEY   = 'rdc-skills@rdc-skills';
const MARKETPLACE  = 'rdc-skills';
const NPM_PACKAGE  = '@lifeaitools/rdc-skills';
const MCP_NAME     = 'rdc-skills-mcp';
const MCP_PORT     = '3110';

// ── Logging ───────────────────────────────────────────────────────────────────
const ok   = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const info = msg => console.log(`  \x1b[36m→\x1b[0m ${msg}`);
const warn = msg => console.log(`  \x1b[33m⚠\x1b[0m ${msg}`);
const fail = msg => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);

function run(cmd, options = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...options }).trim();
}

// ── Filesystem helpers ────────────────────────────────────────────────────────
function copyDir(src, dst, ext) {
  if (!fs.existsSync(src)) { warn(`Source not found: ${src}`); return 0; }
  fs.mkdirSync(dst, { recursive: true });
  const files = fs.readdirSync(src).filter(f => !ext || f.endsWith(ext));
  let count = 0;
  for (const f of files) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) { fs.copyFileSync(s, path.join(dst, f)); count++; }
  }
  return count;
}

function copyHookFiles(src, dst) {
  if (!fs.existsSync(src)) { warn(`Source not found: ${src}`); return 0; }
  fs.mkdirSync(dst, { recursive: true });
  const files = fs.readdirSync(src).filter(f => /\.(?:js|ps1)$/i.test(f));
  let count = 0;
  for (const f of files) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) { fs.copyFileSync(s, path.join(dst, f)); count++; }
  }
  return count;
}

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else {
      // Atomic write (temp + rename) so a live Claude Code / Codex session never
      // reads a half-written skill file when the installer runs over a live box.
      const tmp = `${d}.tmp-${process.pid}`;
      fs.copyFileSync(s, tmp);
      fs.renameSync(tmp, d);
    }
  }
}

function copyMissingProjectGuides(projectRoot) {
  if (!projectRoot) return 0;
  const src = path.join(repoRoot, 'guides');
  const dst = path.join(projectRoot, '.rdc', 'guides');
  if (!fs.existsSync(src) || !fs.existsSync(dst)) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name === 'rdc-skills-startup.md') continue; // installed only by --write-startup-blocks
    const target = path.join(dst, entry.name);
    if (fs.existsSync(target)) continue;
    fs.copyFileSync(path.join(src, entry.name), target);
    copied++;
  }
  return copied;
}

function readJson(p, fallback = {}) {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, data, indent = 2) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, indent));
}

function upsertManagedBlock(filePath, title, body) {
  const begin = `<!-- BEGIN RDC-SKILLS:${title} -->`;
  const end = `<!-- END RDC-SKILLS:${title} -->`;
  const block = `${begin}\n${body.trim()}\n${end}\n`;
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const re = new RegExp(`${begin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'm');
  const next = re.test(current)
    ? current.replace(re, block)
    : `${current.replace(/\s*$/, '')}${current.trim() ? '\n\n' : ''}${block}`;
  if (next !== current) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, next);
    return true;
  }
  return false;
}

function writeStartupBlocks(targetRoot, profile) {
  if (!targetRoot) return { wrote: 0, skipped: 'no-project-root' };
  const startupSrc = path.join(repoRoot, 'guides', 'rdc-skills-startup.md');
  const guidesDir = path.join(targetRoot, '.rdc', 'guides');
  const startupDst = path.join(guidesDir, 'rdc-skills-startup.md');
  fs.mkdirSync(guidesDir, { recursive: true });
  fs.copyFileSync(startupSrc, startupDst);

  let wrote = 1;
  const claudeBody = [
    '## RDC Skills',
    '',
    '@.rdc/guides/rdc-skills-startup.md',
    '',
    `Installed profile: \`${profile}\`.`,
    'For `/rdc:*` work, follow `.rdc/guides/output-contract.md` and `.rdc/guides/engineering-behavior.md`.',
  ].join('\n');
  const agentsBody = [
    '## RDC Skills',
    '',
    'Read `.rdc/guides/rdc-skills-startup.md` before using any `rdc:*` workflow.',
    `Installed profile: \`${profile}\`.`,
    'For `/rdc:*` work, follow `.rdc/guides/output-contract.md` and `.rdc/guides/engineering-behavior.md`.',
  ].join('\n');

  if (upsertManagedBlock(path.join(targetRoot, 'CLAUDE.md'), 'STARTUP', claudeBody)) wrote++;
  if (upsertManagedBlock(path.join(targetRoot, 'AGENTS.md'), 'STARTUP', agentsBody)) wrote++;
  return { wrote, skipped: null };
}

// ── Frontmatter parser ────────────────────────────────────────────────────────
function readFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const fm = {};
    let key = null, multiline = false, multilineVal = '';
    for (const line of match[1].split('\n')) {
      if (multiline) {
        if (/^\s+/.test(line)) { multilineVal += ' ' + line.trim(); continue; }
        fm[key] = multilineVal.trim();
        multiline = false;
      }
      const kv = line.match(/^(\w+):\s*(>-|>)?\s*(.*)?$/);
      if (!kv) continue;
      key = kv[1];
      if (kv[2]) { multiline = true; multilineVal = kv[3] || ''; }
      else fm[key] = kv[3] || '';
    }
    if (multiline && key) fm[key] = multilineVal.trim();
    return fm;
  } catch { return {}; }
}

// ── Plugin cache builder (shared between CLI + Cowork) ────────────────────────
function buildPluginCache(cacheDir, version, gitSha) {
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const item of ['.claude-plugin', 'commands', 'skills', 'guides', 'hooks', 'package.json', 'README.md']) {
    const src = path.join(repoRoot, item);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(cacheDir, item);
    if (fs.statSync(src).isDirectory()) copyDirRecursive(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function getPm2Process(name) {
  try {
    const list = JSON.parse(run('pm2 jlist'));
    return Array.isArray(list) ? list.find((p) => p.name === name) || null : null;
  } catch {
    return null;
  }
}

function isGlobalNpmRdcSkillsPath(scriptPath) {
  if (!scriptPath) return false;
  const normalized = scriptPath.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/node_modules/@lifeaitools/rdc-skills/');
}

function packageRootFromMcpScript(scriptPath) {
  return scriptPath ? path.resolve(path.dirname(scriptPath), '..') : null;
}

function readInstalledPackageVersion(scriptPath) {
  const packageRoot = packageRootFromMcpScript(scriptPath);
  if (!packageRoot) return null;
  return readJson(path.join(packageRoot, 'package.json'), {}).version || null;
}

function syncGlobalMcpInstall(version) {
  const proc = getPm2Process(MCP_NAME);
  if (!proc) {
    info('[2.9] MCP pkg    — PM2 process not registered yet; start handled below');
    return;
  }

  const scriptPath = proc.pm2_env?.pm_exec_path || proc.pm_exec_path || '';
  if (!isGlobalNpmRdcSkillsPath(scriptPath)) {
    info(`[2.9] MCP pkg    — PM2 uses source checkout, not global npm (${scriptPath || 'unknown path'})`);
    return;
  }

  const installedVersion = readInstalledPackageVersion(scriptPath);
  if (installedVersion === version) {
    ok(`[2.9] MCP pkg    — global ${NPM_PACKAGE}@${version} already installed`);
    return;
  }

  let stopped = false;
  let installed = false;
  try {
    info(`[2.9] MCP pkg    — updating global ${NPM_PACKAGE} ${installedVersion || '?'} → ${version}`);
    run(`pm2 stop ${MCP_NAME}`);
    stopped = true;
    run(`npm install -g ${NPM_PACKAGE}@${version}`);
    installed = true;
    ok(`[2.9] MCP pkg    — installed global ${NPM_PACKAGE}@${version}`);
  } catch (e) {
    warn(`[2.9] MCP pkg    — global install failed (${String(e.message || e).split('\n')[0]})`);
    if (String(e.message || '').includes('EBUSY')) {
      info('       PM2 was stopped first; if EBUSY persists, another Node/npm process still holds the package directory.');
    }
  } finally {
    if (stopped) {
      try {
        run(`pm2 restart ${MCP_NAME} --update-env`, { env: { ...process.env, PORT: MCP_PORT } });
        ok(`[2.9] MCP pkg    — pm2 restarted ${MCP_NAME}${installed ? '' : ' (previous install restored)'}`);
      } catch (e) {
        warn(`[2.9] MCP pkg    — pm2 restart failed (${String(e.message || e).split('\n')[0]})`);
      }
    }
  }
}

// ── User-skills cleanup ───────────────────────────────────────────────────────
// Older installer versions wrote skill files directly to ~/.claude/skills/user/.
// Claude Code loads that directory AND the plugin cache, so any rdc skills left
// there produce duplicate registrations and break the resolver.
// This function nukes any entry whose frontmatter name starts with "rdc:".
// Scans BOTH the immediate dir and nested .md files (e.g. `user/skill.md`,
// `user/rdc-build/SKILL.md`) so pre-plugin orphans are caught regardless of
// naming convention.
function cleanUserSkills(userSkillsDir) {
  if (!fs.existsSync(userSkillsDir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(userSkillsDir, { withFileTypes: true })) {
    const candidate = path.join(userSkillsDir, entry.name);
    if (entry.isDirectory()) {
      // Subdir form: <name>/SKILL.md or <name>/skill.md
      let skillFile = null;
      for (const sf of ['SKILL.md', 'skill.md']) {
        const p = path.join(candidate, sf);
        if (fs.existsSync(p)) { skillFile = p; break; }
      }
      if (!skillFile) continue;
      const fm = readFrontmatter(skillFile);
      if (fm.name && fm.name.startsWith('rdc:')) {
        try { fs.rmSync(candidate, { recursive: true, force: true }); removed++; } catch {}
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // ANY .md file at this level — including skill.md / SKILL.md / README.md
      // if their frontmatter declares an rdc:* skill. A previous version skipped
      // those names; that left an orphan rdc:build copy at user/skill.md which
      // registered as a duplicate "user" skill.
      const fm = readFrontmatter(candidate);
      if (fm.name && fm.name.startsWith('rdc:')) {
        try { fs.unlinkSync(candidate); removed++; } catch {}
      }
    }
  }
  return removed;
}

// Scrub legacy rdc orphans from ~/.claude/skills/ (top-level), not just user/.
// Some older installs landed flat skill files alongside the plugin tree.
function cleanGlobalSkillsRoot(skillsDir) {
  if (!fs.existsSync(skillsDir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.name === 'user') continue; // handled separately
    const candidate = path.join(skillsDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const fm = readFrontmatter(candidate);
      if (fm.name && fm.name.startsWith('rdc:')) {
        try { fs.unlinkSync(candidate); removed++; } catch {}
      }
    }
  }
  return removed;
}

// ── Stale hook cleanup ────────────────────────────────────────────────────────
// Remove ONLY explicitly orphaned hook files — hooks that were previously shipped
// by rdc-skills and have since been removed from the project.
// NEVER use "not in source = remove" logic: most hooks in ~/.claude/hooks/ are
// not managed by rdc-skills (they come from other plugins or were written directly).
function cleanStaleHooks(hooksDstDir) {
  if (!fs.existsSync(hooksDstDir)) return 0;
  // Explicit orphan list — add entries here when a hook is intentionally removed.
  // Format: filename that should be deleted if it still exists.
  const ORPHANED_HOOKS = [
    'verify-rdc-skills.js', // removed in v0.9.7 — was checking for old flat-file format
  ];
  let removed = 0;
  for (const f of ORPHANED_HOOKS) {
    const p = path.join(hooksDstDir, f);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); removed++; } catch {}
    }
  }
  return removed;
}

// Project-local hookify docs were a temporary workaround for work item exit
// enforcement. The plugin hook is now authoritative, so installs clean those
// local shims from known RDC workspaces instead of leaving two gates to drift.
function cleanProjectHookifyShims(projectRoot) {
  if (!projectRoot) return 0;
  const hookifyDir = path.join(projectRoot, '.claude');
  if (!fs.existsSync(hookifyDir)) return 0;
  const stale = [
    'hookify.work-item-done-gate-bash.local.md',
    'hookify.work-item-done-gate-mcp.local.md',
    'hookify.work-item-review-gate-bash.local.md',
    'hookify.work-item-review-gate-mcp.local.md',
  ];
  let removed = 0;
  for (const f of stale) {
    const p = path.join(hookifyDir, f);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); removed++; } catch {}
    }
  }
  return removed;
}

// ── Cache flush helper ────────────────────────────────────────────────────────
// Only `latest/` is ever kept. Earlier versions wrote BOTH `<version>/` and
// `latest/`, which caused the plugin loader to scan and register every rdc:*
// skill twice (once per directory). The fix is permanent single-dir layout.
function flushOldCaches(cacheBase /* keepVersion intentionally unused */) {
  if (!fs.existsSync(cacheBase)) return 0;
  let flushed = 0;
  for (const entry of fs.readdirSync(cacheBase)) {
    if (entry === 'latest') continue;
    try {
      fs.rmSync(path.join(cacheBase, entry), { recursive: true, force: true });
      flushed++;
    } catch {}
  }
  return flushed;
}

// ── Step 2: CLI plugin registration (→ ~/.claude/plugins/) ───────────────────
function registerCLI(version, gitSha) {
  const pluginDir  = path.join(claudeHome, 'plugins');
  const mktDir     = path.join(pluginDir, 'marketplaces', MARKETPLACE);
  const mktPlugDir = path.join(mktDir, '.claude-plugin');
  const cacheBase  = path.join(pluginDir, 'cache', MARKETPLACE, 'rdc-skills');
  const latestDir  = path.join(cacheBase, 'latest');

  // 1. Marketplace manifest
  fs.mkdirSync(mktPlugDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, '.claude-plugin', 'marketplace.json'), path.join(mktPlugDir, 'marketplace.json'));

  // 2. known_marketplaces.json
  const kmpPath = path.join(pluginDir, 'known_marketplaces.json');
  const knownMp = readJson(kmpPath);
  knownMp[MARKETPLACE] = { source: { source: 'github', repo: 'LIFEAI/rdc-skills' }, installLocation: mktDir, lastUpdated: new Date().toISOString() };
  writeJson(kmpPath, knownMp, 4);

  // 3. Flush every cache dir except `latest/`, then rewrite `latest/`. We
  // intentionally do NOT keep a versioned dir — the plugin loader registers
  // every dir it finds, so two dirs = duplicate skills.
  const flushed = flushOldCaches(cacheBase);
  if (flushed > 0) info(`       flushed  : ${flushed} stale cache dir(s)`);
  if (fs.existsSync(latestDir)) fs.rmSync(latestDir, { recursive: true, force: true });
  buildPluginCache(latestDir, version, gitSha);

  // 4. installed_plugins.json — register 'latest/' as stable installPath so
  // re-installs overwrite in-place rather than creating orphaned version dirs.
  // Open terminals that re-read installed_plugins.json mid-session will pick
  // up the updated path; otherwise a terminal restart is needed.
  const ipPath    = path.join(pluginDir, 'installed_plugins.json');
  const installed = readJson(ipPath, { version: 2, plugins: {} });
  // Also overwrite whichever installPath the old entry had, so any open
  // terminal that already loaded that path sees fresh files.
  const oldEntries = installed.plugins[PLUGIN_KEY] || [];
  for (const old of oldEntries) {
    if (old.installPath && fs.existsSync(old.installPath) && old.installPath !== latestDir) {
      try { buildPluginCache(old.installPath, version, gitSha); } catch {}
    }
  }
  for (const key of Object.keys(installed.plugins || {})) {
    if (key.startsWith('rdc-skills@')) delete installed.plugins[key];
  }
  installed.plugins[PLUGIN_KEY] = [{ scope: 'user', installPath: latestDir, version, installedAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), gitCommitSha: gitSha }];
  writeJson(ipPath, installed, 4);

  // 5. settings.json enabledPlugins
  const settings = readJson(settingsPath);
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  for (const key of Object.keys(settings.enabledPlugins)) {
    if (key.startsWith('rdc-skills@')) delete settings.enabledPlugins[key];
  }
  settings.enabledPlugins[PLUGIN_KEY] = true;
  writeJson(settingsPath, settings);

  return latestDir;
}

// ── Step 3: Cowork (Claude Desktop) registration ──────────────────────────────
function findCoworkBases() {
  // Cowork stores per-workspace state at:
  //   %LOCALAPPDATA%/Packages/Claude_*/LocalCache/Roaming/Claude/local-agent-mode-sessions/<workspace>/<device>/
  // Each has cowork_settings.json + cowork_plugins/
  const results = [];

  // Candidate MSIX package roots
  const localAppData = process.env.LOCALAPPDATA || '';
  const pkgsDir = path.join(localAppData, 'Packages');
  if (!fs.existsSync(pkgsDir)) return results;

  let claudePkg = null;
  for (const dir of fs.readdirSync(pkgsDir)) {
    if (/^Claude_/i.test(dir)) { claudePkg = path.join(pkgsDir, dir); break; }
  }
  if (!claudePkg) return results;

  const sessionsRoot = path.join(claudePkg, 'LocalCache', 'Roaming', 'Claude', 'local-agent-mode-sessions');
  if (!fs.existsSync(sessionsRoot)) return results;

  // Walk two levels: <workspace>/<device>/cowork_settings.json
  for (const ws of fs.readdirSync(sessionsRoot)) {
    const wsDir = path.join(sessionsRoot, ws);
    if (!fs.statSync(wsDir).isDirectory()) continue;
    for (const dev of fs.readdirSync(wsDir)) {
      const devDir = path.join(wsDir, dev);
      if (!fs.statSync(devDir).isDirectory()) continue;
      const settingsFile = path.join(devDir, 'cowork_settings.json');
      if (fs.existsSync(settingsFile)) {
        results.push({ dir: devDir, settingsFile });
      }
    }
  }
  return results;
}

function registerCowork(version, gitSha) {
  const bases = findCoworkBases();
  if (bases.length === 0) {
    warn('Cowork     — Claude Desktop not found (MSIX package missing)');
    return 0;
  }

  for (const { dir, settingsFile } of bases) {
    const pluginsDir = path.join(dir, 'cowork_plugins');
    const cacheBase  = path.join(pluginsDir, 'cache', MARKETPLACE, 'rdc-skills');
    const latestDir  = path.join(cacheBase, 'latest');
    const mktDir     = path.join(pluginsDir, 'marketplaces', MARKETPLACE);
    const mktPlugDir = path.join(mktDir, '.claude-plugin');

    // Marketplace manifest
    fs.mkdirSync(mktPlugDir, { recursive: true });
    fs.copyFileSync(path.join(repoRoot, '.claude-plugin', 'marketplace.json'), path.join(mktPlugDir, 'marketplace.json'));

    // known_marketplaces.json
    const kmpPath = path.join(pluginsDir, 'known_marketplaces.json');
    const knownMp = readJson(kmpPath);
    knownMp[MARKETPLACE] = { source: { source: 'github', repo: 'LIFEAI/rdc-skills' }, installLocation: mktDir, lastUpdated: new Date().toISOString() };
    writeJson(kmpPath, knownMp, 4);

    // Flush all non-latest caches and rewrite `latest/` only — single-dir layout
    flushOldCaches(cacheBase);
    if (fs.existsSync(latestDir)) fs.rmSync(latestDir, { recursive: true, force: true });
    buildPluginCache(latestDir, version, gitSha);

    // installed_plugins.json — use stable 'latest/' path
    const ipPath    = path.join(pluginsDir, 'installed_plugins.json');
    const installed = readJson(ipPath, { version: 2, plugins: {} });
    for (const key of Object.keys(installed.plugins || {})) {
      if (key.startsWith('rdc-skills@')) delete installed.plugins[key];
    }
    installed.plugins[PLUGIN_KEY] = [{ scope: 'user', installPath: latestDir, version, installedAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), gitCommitSha: gitSha }];
    writeJson(ipPath, installed, 4);

    // cowork_settings.json — enabledPlugins + extraKnownMarketplaces
    const settings = readJson(settingsFile);
    if (!settings.enabledPlugins) settings.enabledPlugins = {};
    for (const key of Object.keys(settings.enabledPlugins)) {
      if (key.startsWith('rdc-skills@')) delete settings.enabledPlugins[key];
    }
    settings.enabledPlugins[PLUGIN_KEY] = true;
    if (!settings.extraKnownMarketplaces) settings.extraKnownMarketplaces = {};
    settings.extraKnownMarketplaces[MARKETPLACE] = { source: { source: 'github', repo: 'LIFEAI/rdc-skills' } };
    writeJson(settingsFile, settings);
  }

  return bases.length;
}

// ── Codex registration (→ Codex skill dirs/rdc-*/) ───────────────────────────
function addCodexTarget(targets, label, targetDir) {
  if (!targetDir) return;
  const resolved = path.resolve(targetDir);
  if (targets.some(t => t.targetDir.toLowerCase() === resolved.toLowerCase())) return;
  targets.push({ label, targetDir: resolved });
}

// Register the rdc-skills MCP endpoint at the USER/GLOBAL level for every client
// so all Claude Code projects and all Codex sessions can reach the skills via MCP
// (not just where a project .mcp.json exists). Idempotent + non-fatal. Mirrors the
// existing clauth/codeflow entries exactly. claude.ai web still needs the one-time
// connector add in its UI (no programmatic API).
function registerMcpEndpoints() {
  const MCP_URL = 'https://rdc-skills.regendevcorp.com/mcp';
  const out = [];

  // Claude Code — user-level ~/.claude.json mcpServers (covers EVERY project).
  try {
    const claudeJson = path.join(os.homedir(), '.claude.json');
    if (fs.existsSync(claudeJson)) {
      const data = readJson(claudeJson);
      if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {};
      const cur = data.mcpServers['rdc-skills'];
      if (!cur || cur.url !== MCP_URL) {
        data.mcpServers['rdc-skills'] = { type: 'http', url: MCP_URL };
        writeJson(claudeJson, data, 2);
        out.push('claude(~/.claude.json)');
      }
    }
  } catch (e) { out.push(`claude WARN:${e.message}`); }

  // Codex — append [mcp_servers.rdc-skills] to ~/.codex/config.toml if absent.
  try {
    const codexToml = path.join(os.homedir(), '.codex', 'config.toml');
    if (fs.existsSync(codexToml)) {
      const toml = fs.readFileSync(codexToml, 'utf8');
      if (!/\[mcp_servers\.rdc-skills\]/.test(toml)) {
        const block = `\n[mcp_servers.rdc-skills]\nurl = '${MCP_URL}'\n`;
        fs.writeFileSync(codexToml, toml.replace(/\s*$/, '\n') + block);
        out.push('codex(~/.codex/config.toml)');
      }
    }
  } catch (e) { out.push(`codex WARN:${e.message}`); }

  return out;
}

function findCodexTargets() {
  const targets = [];
  if (codexRoot) {
    addCodexTarget(targets, 'project .agents', path.join(codexRoot, '.agents', 'skills', 'user'));
  }
  if (explicitCodexSkillDir) {
    addCodexTarget(targets, 'explicit', explicitCodexSkillDir);
  }

  const codexHomeSkills = path.join(os.homedir(), '.codex', 'skills');
  if (fs.existsSync(codexHomeSkills)) {
    addCodexTarget(targets, 'global .codex', codexHomeSkills);
  }

  const globalAgentSkills = path.join(os.homedir(), '.agents', 'skills');
  if (fs.existsSync(globalAgentSkills)) {
    addCodexTarget(targets, 'global .agents', globalAgentSkills);
  }

  return targets;
}

function registerCodexTarget(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  // Clean: remove dirs that are rdc skills — by prefix OR by frontmatter name
  let removed = 0;
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(targetDir, entry.name);
    if (/^rdc-/.test(entry.name)) {
      fs.rmSync(candidate, { recursive: true, force: true });
      removed++;
    } else {
      const fm = readFrontmatter(path.join(candidate, 'SKILL.md'));
      if (fm.name && fm.name.startsWith('rdc:')) {
        fs.rmSync(candidate, { recursive: true, force: true });
        removed++;
      }
    }
  }

  // Copy: each source skill dir that has a SKILL.md → rdc-<name>/
  const skillsSrc = path.join(repoRoot, 'skills');
  let copied = 0;
  for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsSrc, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const dst = path.join(targetDir, `rdc-${entry.name}`);
    copyDirRecursive(path.join(skillsSrc, entry.name), dst);
    copied++;
  }

  return { removed, copied };
}

// ── Step 6: Zip for claude.ai / distribution ─────────────────────────────────
function buildZip(version) {
  const distDir = path.join(repoRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const zipPath = path.join(distDir, `rdc-skills-plugin-v${version}.zip`);

  // Remove old zips
  if (fs.existsSync(distDir)) {
    for (const f of fs.readdirSync(distDir)) {
      if (f.startsWith('rdc-skills-plugin') && f.endsWith('.zip')) {
        fs.unlinkSync(path.join(distDir, f));
      }
    }
  }

  // Use PowerShell Compress-Archive on Windows, zip on Unix
  const items = ['.claude-plugin', 'commands', 'skills', 'guides', 'hooks', 'package.json', 'README.md']
    .filter(i => fs.existsSync(path.join(repoRoot, i)));

  try {
    if (process.platform === 'win32') {
      // Stage to a temp dir so we get a clean zip root
      const tmp = path.join(os.tmpdir(), `rdc-skills-zip-${Date.now()}`);
      fs.mkdirSync(tmp, { recursive: true });
      for (const item of items) {
        const src = path.join(repoRoot, item);
        const dst = path.join(tmp, item);
        if (fs.statSync(src).isDirectory()) copyDirRecursive(src, dst);
        else fs.copyFileSync(src, dst);
      }
      // Try pwsh first (PowerShell 7+), fall back to Windows PowerShell
      const psExe = fs.existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
        ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
        : 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      execSync(
        `"${psExe}" -NoProfile -NonInteractive -WindowStyle Hidden -Command "Compress-Archive -Path '${tmp}\\*' -DestinationPath '${zipPath}' -Force"`,
        { stdio: 'pipe' }
      );
      fs.rmSync(tmp, { recursive: true, force: true });
    } else {
      const itemList = items.join(' ');
      execSync(`zip -r "${zipPath}" ${itemList}`, { cwd: repoRoot, stdio: 'pipe' });
    }
    return zipPath;
  } catch (e) {
    warn(`Zip failed: ${e.message}`);
    return null;
  }
}

// ── Hook config ───────────────────────────────────────────────────────────────
function buildHooksConfig(hooksDir, profile = 'core') {
  const base = hooksDir.replace(/\\/g, '/');
  const cmd  = (file, msg) => {
    const command = process.platform === 'win32'
      ? `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${base}/run-hidden-hook.ps1" "${base}/${file}"`
      : `node "${base}/${file}"`;
    const entry = { type: 'command', command };
    if (msg) entry.statusMessage = msg;
    return entry;
  };
  const config = {
    UserPromptExpansion: [{ hooks: [
      cmd('rdc-invocation-marker.js', 'Marking RDC slash command...'),
    ]}],
    UserPromptSubmit: [{ hooks: [
      cmd('rdc-invocation-marker.js', 'Marking RDC prompt...'),
    ]}],
    PreToolUse: [
      { hooks: [
        cmd('foreground-process-gate.js', 'Checking foreground process policy...'),
      ]},
      { matcher: 'Bash', hooks: [
        cmd('require-work-item-on-commit.js'),
      ]},
    ],
    PostToolUse: [
      { hooks: [
        cmd('check-services.js'),
      ]},
      { matcher: 'Bash', hooks: [
        cmd('require-work-item-on-commit.js', 'Capturing commit SHA for work item...'),
      ]},
    ],
    Stop: [{ hooks: [
      cmd('rdc-output-contract-gate.js', 'Checking RDC output contract...'),
      cmd('post-work-check.js',    'Checking for undocumented work...'),
    ]}],
  };

  if (profile === 'lifeai') {
    config.SessionStart = [{ hooks: [
      cmd('check-rdc-environment.js', 'Checking RDC skills runtime...'),
      cmd('check-cwd.js'),
      cmd('check-stale-work-items.js', 'Checking for stale work items...'),
      // Truth Gate 3.0 Layer 6 — gate watchdog (ADVISORY; SessionStart cannot block).
      cmd('gate-watchdog-selfcheck.js', 'Truth Gate watchdog: verifying gate registration...'),
    ]}];
    config.PreToolUse[0].hooks.push(
      cmd('work-item-exit-gate.js', 'Checking work item exit gates...'),
    );
    // Truth Gate 3.0 Layer 5 — harness completion gates. Both blocking hooks are
    // FLAG-GATED, default OFF (no-op until the env/DB flag is flipped at deploy),
    // so registering them does NOT disrupt the in-flight build session.
    config.TaskCompleted = [{ hooks: [
      cmd('task-completed-gate.js', 'Truth Gate: verifying task closure...'),
    ]}];
    config.PostToolBatch = [{ hooks: [
      cmd('post-tool-batch-gate.js', 'Truth Gate: checking build-wave worktree bases...'),
    ]}];
    config.PreCompact = [{ hooks: [
      cmd('precompact-log.js'),
    ]}];
    config.PostCompact = [{ hooks: [
      cmd('postcompact-log.js'),
      cmd('restart-brief.js', 'Writing restart brief...'),
    ]}];
    config.Stop[0].hooks.unshift(
      cmd('rate-limit-retry.js', 'Checking for rate limits...'),
    );
    config.Stop[0].hooks.push(
      cmd('no-stop-open-epics.js', 'Checking for open epics...'),
    );
  }

  return config;
}

// ── MCP server registration (non-fatal) ───────────────────────────────────────
// Ensures the rdc-skills MCP deps are installed, registers/starts the local MCP
// under PM2 as `rdc-skills-mcp` on PORT=3110, and prints the claude.ai connector
// line. Every failure here WARNs — it must never abort the installer.
function registerMcpServer() {
  const binPath = path.join(repoRoot, 'bin', 'rdc-skills-mcp.mjs');
  const connector = 'https://rdc-skills.regendevcorp.com/mcp';

  try {
    // (a) ensure MCP runtime deps are present (express, @modelcontextprotocol/sdk, yaml, zod)
    const needDeps = ['express', '@modelcontextprotocol/sdk', 'yaml', 'zod'].some((d) => {
      try { require.resolve(d, { paths: [repoRoot] }); return false; } catch { return true; }
    });
    if (needDeps) {
      try {
        execSync('npm install --no-audit --no-fund', { cwd: repoRoot, stdio: 'pipe' });
        ok('[7/7] MCP deps   — installed');
      } catch (e) {
        warn(`[7/7] MCP deps   — npm install failed (${e.message.split('\n')[0]}); install manually with \`npm install\``);
      }
    } else {
      ok('[7/7] MCP deps   — already present');
    }

    // (b) register/start under PM2 (tolerate pm2 missing)
    let pm2Ok = false;
    try { execSync('pm2 -v', { stdio: 'pipe' }); pm2Ok = true; } catch { pm2Ok = false; }

    if (!pm2Ok) {
      warn('[7/7] MCP server — pm2 not found; start manually:');
      info(`       PORT=${MCP_PORT} pm2 start ${binPath} --name ${MCP_NAME}`);
    } else {
      let registered = false;
      try {
        const jlist = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', stdio: 'pipe' }));
        registered = Array.isArray(jlist) && jlist.some((p) => p.name === MCP_NAME);
      } catch {}
      try {
        if (registered) {
          execSync(`pm2 restart ${MCP_NAME} --update-env`, { cwd: repoRoot, stdio: 'pipe', env: { ...process.env, PORT: MCP_PORT } });
          ok(`[7/7] MCP server — pm2 restarted ${MCP_NAME} (PORT=${MCP_PORT})`);
        } else {
          execSync(`pm2 start "${binPath}" --name ${MCP_NAME}`, { cwd: repoRoot, stdio: 'pipe', env: { ...process.env, PORT: MCP_PORT } });
          ok(`[7/7] MCP server — pm2 started ${MCP_NAME} (PORT=${MCP_PORT})`);
        }
      } catch (e) {
        warn(`[7/7] MCP server — pm2 start/restart failed (${e.message.split('\n')[0]})`);
        info(`       PORT=${MCP_PORT} pm2 start ${binPath} --name ${MCP_NAME}`);
      }
    }

    // (c) print the claude.ai connector line
    info(`       claude.ai connector: ${connector}  (Auth: none — URL is the shared secret)`);
  } catch (e) {
    warn(`[7/7] MCP server — skipped (${e.message.split('\n')[0]})`);
  }
}

// ── Preflight ─────────────────────────────────────────────────────────────────
function runPreflight() {
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) { fail(`Node.js >= 18 required — found v${process.versions.node}`); process.exit(1); }
  ok(`Node.js v${process.versions.node}`);
  try {
    execSync('curl -s --max-time 2 http://127.0.0.1:52437/ping', { stdio: 'pipe' });
    ok('clauth daemon is running');
  } catch {
    warn('clauth daemon not responding — start it before using credential-dependent commands');
  }
}

// ── Commands listing ──────────────────────────────────────────────────────────
function listCommands() {
  const cmdsDir = path.join(repoRoot, 'commands');
  if (!fs.existsSync(cmdsDir)) return;
  const files = fs.readdirSync(cmdsDir).filter(f => f.endsWith('.md')).sort();
  console.log('');
  console.log(`  \x1b[32mAvailable /rdc:* commands (${files.length}):\x1b[0m`);
  console.log('');
  const COL = 18;
  for (const f of files) {
    const name  = 'rdc:' + f.replace(/\.md$/, '');
    const fm    = readFrontmatter(path.join(cmdsDir, f));
    const desc  = (fm.description || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const short = desc.length > 70 ? desc.slice(0, 70) + '…' : desc;
    const pad   = ' '.repeat(Math.max(1, COL - name.length));
    console.log(`  \x1b[36m/${name}\x1b[0m${pad}${short}`);
  }
  console.log('');
}

// ── Migrate helper ────────────────────────────────────────────────────────────
async function runMigrate(projectRoot) {
  const absRoot = path.resolve(projectRoot);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(resolve => rl.question(q, resolve));

  console.log('\n  \x1b[35mrdc-skills — Migrate to .rdc/ Layout\x1b[0m\n');
  console.log(`  Project root: ${absRoot}\n`);

  const candidates = [
    { src: 'docs/guides', dst: '.rdc/guides' }, { src: 'docs/plans', dst: '.rdc/plans' },
    { src: 'docs/reports', dst: '.rdc/reports' }, { src: 'docs/research', dst: '.rdc/research' },
  ].filter(c => fs.existsSync(path.join(absRoot, c.src)));

  if (candidates.length === 0) { info('No migratable directories found.'); rl.close(); return; }
  console.log('  Found:');
  candidates.forEach(c => console.log(`    ${c.src}`));
  console.log('');

  for (const c of candidates) {
    const srcAbs = path.join(absRoot, c.src);
    const dstAbs = path.join(absRoot, c.dst);
    const ans = await ask(`  Move ${c.src} → ${c.dst}? [Y/n]: `);
    if (ans.toLowerCase() === 'n') { info(`Skipped ${c.src}`); continue; }
    if (fs.existsSync(dstAbs)) {
      warn(`${c.dst} exists — merging`);
      for (const f of fs.readdirSync(srcAbs)) {
        const sf = path.join(srcAbs, f), df = path.join(dstAbs, f);
        if (!fs.existsSync(df)) fs.renameSync(sf, df);
        else warn(`  Skipped ${f} (exists in dst)`);
      }
    } else {
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      fs.renameSync(srcAbs, dstAbs);
    }
    ok(`Moved ${c.src} → ${c.dst}`);
  }
  rl.close();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (doMigrate) { await runMigrate(migratePath); return; }

  const bannerVersion = (readJson(path.join(repoRoot, 'package.json')).version || '?');
  const bannerLine    = `║  install-rdc-skills v${bannerVersion}`;
  const bannerPadded  = bannerLine.padEnd(41) + '║';
  console.log('');
  console.log('  \x1b[32m╔═══════════════════════════════════════╗\x1b[0m');
  console.log(`  \x1b[32m${bannerPadded}\x1b[0m`);
  console.log('  \x1b[32m╚═══════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log(`  CLAUDE_HOME : ${claudeHome}`);
  console.log(`  Plugin root : ${repoRoot}`);
  console.log(`  Profile     : ${installProfile}${profileArg === 'auto' ? ' (auto)' : ''}`);
  console.log('');

  if (!fs.existsSync(claudeHome)) {
    fs.mkdirSync(claudeHome, { recursive: true });
    warn(`CLAUDE_HOME did not exist — created ${claudeHome}`);
  }
  if (!fs.existsSync(settingsPath)) {
    writeJson(settingsPath, {});
    info(`       created settings.json`);
  }

  // 0. Pull latest
  try {
    const before = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    execSync('git pull --ff-only', { cwd: repoRoot, stdio: 'pipe' });
    const after = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    ok(`[0/6] git pull   — ${before === after ? after.slice(0, 7) : `${before.slice(0,7)} → ${after.slice(0,7)}`}`);
  } catch {
    warn('[0/6] git pull failed — installing from local copy');
  }

  // Read version + git SHA after pull so plugin caches and the MCP install do
  // not stamp the pre-update checkout.
  const pkg     = readJson(path.join(repoRoot, 'package.json'));
  const version = pkg.version || '0.7.0';
  let   gitSha  = '';
  try { gitSha = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim(); } catch {}

  // 0.5a. User-skills cleanup — remove any rdc: skills from ~/.claude/skills/user/
  // (older installer versions wrote there; plugin cache is the only authoritative source)
  {
    const userSkillsDir = path.join(claudeHome, 'skills', 'user');
    const purged = cleanUserSkills(userSkillsDir);
    if (purged > 0) ok(`[0.5a] Skills cleanup — removed ${purged} stale rdc: skill(s) from skills/user/`);
    // Also scan the parent ~/.claude/skills/ for any flat-file rdc orphans.
    const skillsRoot = path.join(claudeHome, 'skills');
    const rootPurged = cleanGlobalSkillsRoot(skillsRoot);
    if (rootPurged > 0) ok(`[0.5a] Skills cleanup — removed ${rootPurged} stale rdc: file(s) from skills/`);
  }

  // 0.5b. Stale hook cleanup — remove hooks we no longer ship
  {
    const staleRemoved = cleanStaleHooks(hooksDst);
    if (staleRemoved > 0) ok(`[0.5b] Hook cleanup — removed ${staleRemoved} orphaned hook file(s)`);
    const shimRemoved = cleanProjectHookifyShims(codexRoot);
    if (shimRemoved > 0) ok(`[0.5b] Hook cleanup — removed ${shimRemoved} project-local work-item hookify shim(s)`);
  }

  // 0.5. Legacy cleanup — remove old commands/rdc/ (pre-plugin-system format)
  const legacyCommandsDir = path.join(claudeHome, 'commands', 'rdc');
  if (fs.existsSync(legacyCommandsDir)) {
    fs.rmSync(legacyCommandsDir, { recursive: true, force: true });
    ok('[0.5] Cleanup    — removed legacy commands/rdc/');
  }
  // Also remove extraKnownMarketplaces.rdc-skills from settings.json to prevent
  // Claude Code from syncing a directory-source marketplace back to known_marketplaces.json
  // (which causes skills to load from both the cache AND the live source directory)
  {
    const st = readJson(settingsPath);
    if (st.extraKnownMarketplaces && st.extraKnownMarketplaces[MARKETPLACE]) {
      delete st.extraKnownMarketplaces[MARKETPLACE];
      if (Object.keys(st.extraKnownMarketplaces).length === 0) delete st.extraKnownMarketplaces;
      writeJson(settingsPath, st);
      ok('[0.5] Cleanup    — removed extraKnownMarketplaces.rdc-skills from settings.json');
    }
  }

  // 1. CLI registration
  const cliCacheDir = registerCLI(version, gitSha);
  ok(`[1/6] CLI plugin — ${PLUGIN_KEY} v${version}`);
  info(`       cache    : ${cliCacheDir}`);

  // 2. Cowork registration
  const coworkCount = registerCowork(version, gitSha);
  if (coworkCount > 0) {
    ok(`[2/6] Cowork     — registered in ${coworkCount} workspace(s)`);
  } else {
    warn('[2/6] Cowork     — no Desktop workspaces found (open Claude Desktop once to create them)');
  }

  // 2.5. Codex registration
  const codexTargets = findCodexTargets();
  if (codexTargets.length > 0) {
    let copiedTotal = 0;
    let removedTotal = 0;
    for (const target of codexTargets) {
      const { removed, copied } = registerCodexTarget(target.targetDir);
      copiedTotal += copied;
      removedTotal += removed;
      info(`       ${target.label.padEnd(15)}: ${target.targetDir} (${copied} installed, ${removed} stale removed)`);
    }
    ok(`[2.5] Codex      — ${copiedTotal} skill install(s), ${removedTotal} stale removed across ${codexTargets.length} target(s)`);
  } else {
    info('[2.5] Codex      — skipped (no Codex skill dirs found; use --codex-root or --codex-skill-dir)');
  }

  // 2.6. Register the rdc-skills MCP endpoint globally (Claude Code + Codex) so
  // EVERY agent can reach the skills via MCP, not only where a project .mcp.json exists.
  const mcpReg = registerMcpEndpoints();
  if (mcpReg.length > 0) {
    ok(`[2.6] MCP        — registered rdc-skills endpoint: ${mcpReg.join(', ')}`);
  } else {
    info('[2.6] MCP        — rdc-skills endpoint already registered (claude + codex)');
  }

  // If the live MCP is served from the global npm package, update that exact
  // install before restarting PM2. Windows otherwise holds the package tree open
  // and `npm install -g` can fail with EBUSY.
  syncGlobalMcpInstall(version);

  // 2.7. Symlinks in regen-root/.claude/skills/ (FS MCP + claude.ai access)
  if (codexRoot) {
    const skillsLinkDir = path.join(codexRoot, '.claude', 'skills');
    const skillsSrc     = path.join(repoRoot, 'skills');
    fs.mkdirSync(skillsLinkDir, { recursive: true });
    let linked = 0;
    for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!fs.existsSync(path.join(skillsSrc, entry.name, 'SKILL.md'))) continue;
      const linkPath = path.join(skillsLinkDir, entry.name);
      const target   = path.join(skillsSrc, entry.name);
      try {
        if (fs.existsSync(linkPath) || (() => { try { fs.lstatSync(linkPath); return true; } catch { return false; } })()) {
          fs.rmSync(linkPath, { recursive: true, force: true });
        }
      } catch {}
      try {
        if (process.platform === 'win32') {
          fs.symlinkSync(target, linkPath, 'junction');
        } else {
          fs.symlinkSync(target, linkPath, 'dir');
        }
        linked++;
      } catch {}
    }
    if (linked > 0) {
      ok(`[2.7] Symlinks   — ${linked} skill link(s) in ${skillsLinkDir}`);
    } else {
      info('[2.7] Symlinks   — no rdc skill links created (skills may already be linked)');
    }
    const projectGuideCount = copyMissingProjectGuides(codexRoot);
    if (projectGuideCount > 0) {
      ok(`[2.8] Guides     — ${projectGuideCount} missing guide(s) copied to ${path.join(codexRoot, '.rdc', 'guides')}`);
    } else {
      info('[2.8] Guides     — project .rdc/guides already has base guide files or is absent');
    }
  } else {
    info('[2.7] Symlinks   — skipped (no codex root found)');
  }

  // 3. Hook files
  const hookCount = copyHookFiles(hooksSrc, hooksDst);
  ok(`[3/6] Hook files — ${hookCount} file(s) → ${hooksDst}`);

  // 4. Hook wiring
  if (skipHooks) {
    info('[4/6] Hook wiring — skipped (--skip-hooks)');
  } else {
    const settings = readJson(settingsPath);
    settings.hooks = buildHooksConfig(hooksDst, installProfile);
    writeJson(settingsPath, settings);
    ok(`[4/6] Hook wiring — ${settingsPath}`);
  }

  // 4.5 Optional startup blocks
  if (shouldWriteStartupBlocks) {
    const startup = writeStartupBlocks(projectRoot, installProfile);
    if (startup.skipped) warn(`[4.5] Startup   — skipped (${startup.skipped})`);
    else ok(`[4.5] Startup   — wrote managed startup guide/block(s) under ${projectRoot}`);
  } else {
    info('[4.5] Startup   — skipped (use --project-root <path> --write-startup-blocks)');
  }

  // 5. Zip for claude.ai / distribution
  const zipPath = buildZip(version);
  if (zipPath) {
    ok(`[5/6] Plugin zip  — ${zipPath}`);
    info('       claude.ai : upload this zip when prompted to add a plugin');
  } else {
    warn('[5/6] Plugin zip  — build failed (zip/powershell missing?)');
  }

  // 6. Preflight
  console.log('');
  console.log('  \x1b[36mPreflight:\x1b[0m');
  runPreflight();

  // 6.5 Post-install verification — duplication guard
  console.log('');
  console.log('  \x1b[36mPost-install verification:\x1b[0m');
  let verifyFailed = false;
  {
    const cacheBase = path.join(claudeHome, 'plugins', 'cache', MARKETPLACE, 'rdc-skills');
    const cacheDirs = fs.existsSync(cacheBase) ? fs.readdirSync(cacheBase) : [];
    if (cacheDirs.length === 1 && cacheDirs[0] === 'latest') {
      ok(`plugin cache    : 1 dir (latest/)`);
    } else {
      fail(`plugin cache    : expected exactly [latest/], found [${cacheDirs.join(', ')}]`);
      verifyFailed = true;
    }
    const ipPath    = path.join(claudeHome, 'plugins', 'installed_plugins.json');
    const installed = readJson(ipPath, { plugins: {} });
    const rdcEntries = installed.plugins[PLUGIN_KEY] || [];
    if (rdcEntries.length === 1) {
      ok(`installed_plugins: 1 entry for ${PLUGIN_KEY}`);
    } else {
      fail(`installed_plugins: expected 1 entry, found ${rdcEntries.length}`);
      verifyFailed = true;
    }
    const userSkillsDir = path.join(claudeHome, 'skills', 'user');
    const stillThere = fs.existsSync(userSkillsDir)
      ? fs.readdirSync(userSkillsDir).filter(f => {
          const p = path.join(userSkillsDir, f);
          const skillFile = fs.statSync(p).isDirectory()
            ? ['SKILL.md','skill.md'].map(s => path.join(p, s)).find(fs.existsSync)
            : (f.endsWith('.md') ? p : null);
          if (!skillFile) return false;
          const fm = readFrontmatter(skillFile);
          return fm.name && fm.name.startsWith('rdc:');
        })
      : [];
    if (stillThere.length === 0) {
      ok(`skills/user/    : no rdc: orphans`);
    } else {
      fail(`skills/user/    : still has rdc: orphans: ${stillThere.join(', ')}`);
      verifyFailed = true;
    }
  }
  if (verifyFailed) {
    console.log('');
    fail('Post-install verification FAILED — duplicates or orphans remain. Investigate.');
    process.exit(2);
  }

  // 7. MCP server registration (non-fatal — WARNs only, never aborts)
  console.log('');
  console.log('  \x1b[36mMCP server:\x1b[0m');
  try { registerMcpServer(); } catch (e) { warn(`[7/7] MCP server — unexpected error (${e.message})`); }

  // Done
  console.log('');
  console.log('  \x1b[32mDone!\x1b[0m');
  console.log('');
  console.log('  \x1b[33mNext steps:\x1b[0m');
  console.log('  CLI    : restart Claude Code — /rdc:status to verify');
  console.log('  Cowork : restart Claude Desktop — /rdc:status in a new Cowork session');
  console.log('  claude.ai : no plugin install needed — use FS MCP to read commands on demand');
  console.log('            dist/rdc-skills-plugin-v' + version + '.zip available if needed');
  console.log('');
  console.log(`  Profile: ${installProfile}`);
  if (installProfile === 'core') {
    console.log('  Core hooks are portable: RDC output contract + foreground process + commit-message hygiene.');
    console.log('  Project services are not provisioned. Configure work items, credentials, deploys, and project guides before using infrastructure-heavy skills.');
  } else {
    console.log('  LIFEAI hooks are active: regen-root cwd lock, Supabase work-item gates, clauth-aware checks, and overnight queue guard.');
  }
  console.log('  Startup blocks: run with --project-root <path> --write-startup-blocks to add managed CLAUDE.md/AGENTS.md sections.');

  listCommands();

  console.log('  Docs: https://github.com/LIFEAI/rdc-skills#readme');
  console.log('');
}

main().catch(e => { fail(e.message); process.exit(1); });
