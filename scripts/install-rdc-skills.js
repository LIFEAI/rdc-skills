#!/usr/bin/env node
/**
 * install-rdc-skills — registers rdc-skills on every Claude surface.
 *
 * Usage:
 *   node scripts/install-rdc-skills.js                      ← standard
 *   node scripts/install-rdc-skills.js --skip-hooks         ← skip hook wiring
 *   node scripts/install-rdc-skills.js --claude-home <path> ← custom CLI home
 *   node scripts/install-rdc-skills.js --migrate <path>     ← migrate docs/ → .rdc/
 *
 * What it does:
 *   1. git pull (latest commands + guides)
 *   2. CLI plugin  — registers in ~/.claude/plugins/ + settings.json
 *   3. Cowork      — registers in Desktop cowork_plugins/ + cowork_settings.json
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
const homeIdx    = args.indexOf('--claude-home');
const claudeHome = homeIdx >= 0 ? args[homeIdx + 1] : path.join(os.homedir(), '.claude');
const migrateIdx = args.indexOf('--migrate');
const doMigrate  = migrateIdx >= 0;
const migratePath = doMigrate ? (args[migrateIdx + 1] || process.cwd()) : null;

const repoRoot     = path.resolve(__dirname, '..');
const hooksSrc     = path.join(repoRoot, 'hooks');
const hooksDst     = path.join(claudeHome, 'hooks');
const settingsPath = path.join(claudeHome, 'settings.json');

const PLUGIN_KEY   = 'rdc-skills@rdc-skills';
const MARKETPLACE  = 'rdc-skills';

// ── Logging ───────────────────────────────────────────────────────────────────
const ok   = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const info = msg => console.log(`  \x1b[36m→\x1b[0m ${msg}`);
const warn = msg => console.log(`  \x1b[33m⚠\x1b[0m ${msg}`);
const fail = msg => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);

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

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function readJson(p, fallback = {}) {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, data, indent = 2) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, indent));
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

// ── Cache flush helper ────────────────────────────────────────────────────────
function flushOldCaches(cacheBase, keepVersion) {
  if (!fs.existsSync(cacheBase)) return 0;
  let flushed = 0;
  for (const entry of fs.readdirSync(cacheBase)) {
    if (entry === keepVersion || entry === 'latest') continue;
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
  const cacheDir   = path.join(cacheBase, version);
  const latestDir  = path.join(cacheBase, 'latest');

  // 1. Marketplace manifest
  fs.mkdirSync(mktPlugDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, '.claude-plugin', 'marketplace.json'), path.join(mktPlugDir, 'marketplace.json'));

  // 2. known_marketplaces.json
  const kmpPath = path.join(pluginDir, 'known_marketplaces.json');
  const knownMp = readJson(kmpPath);
  knownMp[MARKETPLACE] = { source: { source: 'github', repo: 'LIFEAI/rdc-skills' }, installLocation: mktDir, lastUpdated: new Date().toISOString() };
  writeJson(kmpPath, knownMp, 4);

  // 3. Flush stale version caches, then write versioned + stable latest
  const flushed = flushOldCaches(cacheBase, version);
  if (flushed > 0) info(`       flushed  : ${flushed} stale cache dir(s)`);
  buildPluginCache(cacheDir, version, gitSha);
  // Write to stable 'latest/' so open terminals can pick up changes if they
  // re-read installed_plugins.json between skill invocations.
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
    const cacheDir   = path.join(cacheBase, version);
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

    // Flush stale caches, write versioned + stable latest
    flushOldCaches(cacheBase, version);
    buildPluginCache(cacheDir, version, gitSha);
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
        `"${psExe}" -NoProfile -Command "Compress-Archive -Path '${tmp}\\*' -DestinationPath '${zipPath}' -Force"`,
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
function buildHooksConfig(hooksDir) {
  const base = hooksDir.replace(/\\/g, '/');
  const cmd  = (file, msg) => {
    const entry = { type: 'command', command: `node "${base}/${file}"` };
    if (msg) entry.statusMessage = msg;
    return entry;
  };
  return {
    SessionStart: [{ hooks: [
      cmd('check-cwd.js'),
      cmd('check-stale-work-items.js', 'Checking for stale work items...'),
    ]}],
    PreToolUse: [{ matcher: 'Bash', hooks: [
      cmd('require-work-item-on-commit.js'),
    ]}],
    PostToolUse: [{ hooks: [
      cmd('check-services.js'),
    ]}],
    PreCompact: [{ hooks: [
      cmd('precompact-log.js'),
    ]}],
    PostCompact: [{ hooks: [
      cmd('postcompact-log.js'),
      cmd('restart-brief.js', 'Writing restart brief...'),
    ]}],
    Stop: [{ hooks: [
      cmd('rate-limit-retry.js',   'Checking for rate limits...'),
      cmd('post-work-check.js',    'Checking for undocumented work...'),
      cmd('no-stop-open-epics.js', 'Checking for open epics...'),
    ]}],
  };
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
  console.log('');

  if (!fs.existsSync(claudeHome)) {
    fail(`CLAUDE_HOME not found: ${claudeHome}`);
    process.exit(1);
  }

  // Read version + git SHA once
  const pkg     = readJson(path.join(repoRoot, 'package.json'));
  const version = pkg.version || '0.7.0';
  let   gitSha  = '';
  try { gitSha = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim(); } catch {}

  // 0. Pull latest
  try {
    const before = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    execSync('git pull --ff-only', { cwd: repoRoot, stdio: 'pipe' });
    const after = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    ok(`[0/6] git pull   — ${before === after ? after.slice(0, 7) : `${before.slice(0,7)} → ${after.slice(0,7)}`}`);
  } catch {
    warn('[0/6] git pull failed — installing from local copy');
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

  // 3. Hook files
  const hookCount = copyDir(hooksSrc, hooksDst, '.js');
  ok(`[3/6] Hook files — ${hookCount} file(s) → ${hooksDst}`);

  // 4. Hook wiring
  if (skipHooks) {
    info('[4/6] Hook wiring — skipped (--skip-hooks)');
  } else {
    const settings = readJson(settingsPath);
    settings.hooks = buildHooksConfig(hooksDst);
    writeJson(settingsPath, settings);
    ok(`[4/6] Hook wiring — ${settingsPath}`);
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

  // Done
  console.log('');
  console.log('  \x1b[32mDone!\x1b[0m');
  console.log('');
  console.log('  \x1b[33mNext steps:\x1b[0m');
  console.log('  CLI    : restart Claude Code — /rdc:status to verify');
  console.log('  Cowork : restart Claude Desktop — /rdc:status in a new Cowork session');
  console.log('  claude.ai : no plugin install needed — use FS MCP to read commands on demand');
  console.log('            dist/rdc-skills-plugin-v' + version + '.zip available if needed');

  listCommands();

  console.log('  Docs: https://github.com/LIFEAI/rdc-skills#readme');
  console.log('');
}

main().catch(e => { fail(e.message); process.exit(1); });
