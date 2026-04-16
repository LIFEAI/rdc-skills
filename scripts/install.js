#!/usr/bin/env node
/**
 * rdc-skills installer v0.7.0
 * Registers rdc-skills as a Claude Code plugin (no flat-file copy).
 *
 * Usage:
 *   node scripts/install.js                        ← standard install
 *   node scripts/install.js --skip-hooks           ← skip hooks registration
 *   node scripts/install.js --claude-home <path>   ← custom CLAUDE_HOME
 *   node scripts/install.js --project <path>       ← project root for setup scan
 *   node scripts/install.js --setup                ← interactive setup interview
 *   node scripts/install.js --migrate <path>       ← migrate docs/ dirs to .rdc/
 */

const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const readline     = require('readline');
const { execSync } = require('child_process');

// ── Args ──────────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const skipHooks   = args.includes('--skip-hooks');
const doSetup     = args.includes('--setup');
const migrateIdx  = args.indexOf('--migrate');
const doMigrate   = migrateIdx >= 0;
const migratePath = doMigrate ? (args[migrateIdx + 1] || process.cwd()) : null;
const homeIdx     = args.indexOf('--claude-home');
const claudeHome  = homeIdx >= 0 ? args[homeIdx + 1] : path.join(os.homedir(), '.claude');
const projectIdx  = args.indexOf('--project');
const projectArg  = projectIdx >= 0 ? path.resolve(args[projectIdx + 1]) : null;

const repoRoot  = path.resolve(__dirname, '..');
const hooksSrc  = path.join(repoRoot, 'hooks');
const hooksDst  = path.join(claudeHome, 'hooks');
const settingsPath = path.join(claudeHome, 'settings.json');

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok(msg)   { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function info(msg) { console.log(`  \x1b[36m→\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m⚠\x1b[0m ${msg}`); }
function err(msg)  { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }

function copyDir(src, dst, ext) {
  if (!fs.existsSync(src)) { warn(`Source not found: ${src}`); return 0; }
  fs.mkdirSync(dst, { recursive: true });
  const files = fs.readdirSync(src).filter(f => !ext || f.endsWith(ext));
  files.forEach(f => {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dst, f));
  });
  return files.filter(f => fs.statSync(path.join(src, f)).isFile()).length;
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

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function readFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const fm = {};
    let key = null;
    let multiline = false;
    let multilineVal = '';
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

// ── Plugin Registration ───────────────────────────────────────────────────────
function registerPlugin() {
  const pluginDir   = path.join(claudeHome, 'plugins');
  const mktDir      = path.join(pluginDir, 'marketplaces', 'rdc-skills');
  const mktPluginDir = path.join(mktDir, '.claude-plugin');

  // Read version from package.json
  const pkg     = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = pkg.version || '0.7.0';

  // Get current git SHA
  let gitSha = '';
  try { gitSha = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim(); } catch {}

  // 1. Marketplace dir + manifest
  fs.mkdirSync(mktPluginDir, { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
    path.join(mktPluginDir, 'marketplace.json')
  );

  // 2. known_marketplaces.json
  const kmpPath = path.join(pluginDir, 'known_marketplaces.json');
  let knownMp = {};
  if (fs.existsSync(kmpPath)) {
    try { knownMp = JSON.parse(fs.readFileSync(kmpPath, 'utf8')); } catch {}
  }
  knownMp['rdc-skills'] = {
    source:          { source: 'github', repo: 'LIFEAI/rdc-skills' },
    installLocation: mktDir,
    lastUpdated:     new Date().toISOString(),
  };
  fs.writeFileSync(kmpPath, JSON.stringify(knownMp, null, 4));

  // 3. Cache: copy plugin files
  const cacheDir = path.join(pluginDir, 'cache', 'rdc-skills', 'rdc-skills', version);
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const item of ['.claude-plugin', 'commands', 'skills', 'guides', 'hooks', 'package.json', 'README.md']) {
    const src = path.join(repoRoot, item);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(cacheDir, item);
    if (fs.statSync(src).isDirectory()) copyDirRecursive(src, dst);
    else fs.copyFileSync(src, dst);
  }

  // 4. installed_plugins.json
  const ipPath = path.join(pluginDir, 'installed_plugins.json');
  let installed = { version: 2, plugins: {} };
  if (fs.existsSync(ipPath)) {
    try { installed = JSON.parse(fs.readFileSync(ipPath, 'utf8')); } catch {}
  }
  // Remove any stale rdc-skills entries
  for (const key of Object.keys(installed.plugins)) {
    if (key.startsWith('rdc-skills@')) delete installed.plugins[key];
  }
  installed.plugins['rdc-skills@rdc-skills'] = [{
    scope:         'user',
    installPath:   cacheDir,
    version:       version,
    installedAt:   new Date().toISOString(),
    lastUpdated:   new Date().toISOString(),
    gitCommitSha:  gitSha,
  }];
  fs.writeFileSync(ipPath, JSON.stringify(installed, null, 4));

  // 5. settings.json enabledPlugins
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
  }
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  // Remove stale entries
  for (const key of Object.keys(settings.enabledPlugins)) {
    if (key.startsWith('rdc-skills@')) delete settings.enabledPlugins[key];
  }
  settings.enabledPlugins['rdc-skills@rdc-skills'] = true;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return { version, cacheDir };
}

// ── Hooks config ──────────────────────────────────────────────────────────────
function buildHooksConfig(hooksDir) {
  const base = hooksDir.replace(/\\/g, '/');
  const cmd = (file, msg) => {
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

// ── Commands listing ──────────────────────────────────────────────────────────
function listCommands() {
  const cmdsDir = path.join(repoRoot, 'commands');
  if (!fs.existsSync(cmdsDir)) return;

  const files = fs.readdirSync(cmdsDir)
    .filter(f => f.endsWith('.md'))
    .sort();

  console.log('');
  console.log(`  \x1b[32mAvailable rdc:* commands (${files.length}):\x1b[0m`);
  console.log('');

  const COL = 18;
  for (const f of files) {
    const name   = 'rdc:' + f.replace(/\.md$/, '');
    const fm     = readFrontmatter(path.join(cmdsDir, f));
    const desc   = (fm.description || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    // Trim description to first sentence or 70 chars
    const short  = desc.length > 70 ? desc.slice(0, 70) + '…' : desc;
    const pad    = ' '.repeat(Math.max(1, COL - name.length));
    console.log(`  \x1b[36m/${name}\x1b[0m${pad}${short}`);
  }
  console.log('');
}

// ── Preflight ─────────────────────────────────────────────────────────────────
function runPreflight() {
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) { err(`Node.js >= 18 required — found v${process.versions.node}`); process.exit(1); }
  ok(`Node.js v${process.versions.node}`);

  try {
    execSync('curl -s --max-time 2 http://127.0.0.1:52437/ping', { stdio: 'pipe' });
    ok('clauth daemon is running');
  } catch {
    warn('clauth daemon not responding — start it before using credential-dependent commands');
  }
}

// ── Project detection (for setup interview) ───────────────────────────────────
function detectProjectInfo(projectRoot) {
  const detected = {};
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name)        detected.projectName  = pkg.name.replace(/^@[^/]+\//, '');
      if (pkg.description) detected.description  = pkg.description;
    } catch {}
  }
  try {
    const remote = execSync('git remote get-url origin', { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    const m = remote.match(/[:/]([^/]+)\/([^/.]+)(\.git)?$/);
    if (m) { detected.githubOrg = m[1]; detected.githubRepo = m[2]; }
  } catch {}
  try {
    const branches = execSync('git branch -a', { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' });
    if (/\bdevelop\b/.test(branches)) detected.devBranch  = 'develop';
    if (/\bmain\b/.test(branches))    detected.mainBranch = 'main';
    else if (/\bmaster\b/.test(branches)) detected.mainBranch = 'master';
  } catch {}
  const rdcCfg = path.join(projectRoot, '.rdc', 'config.json');
  if (fs.existsSync(rdcCfg)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(rdcCfg, 'utf8'));
      if (cfg.name)             detected.projectName = cfg.name;
      if (cfg.hook_scope)       detected.epicScope   = cfg.hook_scope;
      if (cfg.git?.org)         detected.githubOrg   = cfg.git.org;
      if (cfg.git?.repo)        detected.githubRepo  = cfg.git.repo;
      if (cfg.git?.main_branch) detected.mainBranch  = cfg.git.main_branch;
      if (cfg.git?.dev_branch)  detected.devBranch   = cfg.git.dev_branch;
      if (cfg.supabase?.ref)    detected.supabaseRef = cfg.supabase.ref;
      detected._alreadyHasConfig = true;
    } catch {}
  }
  return detected;
}

// ── Migrate (unchanged from previous version) ─────────────────────────────────
async function runMigrate(projectRoot) {
  const absRoot = path.resolve(projectRoot);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  \x1b[35mrdc-skills — Migrate to .rdc/ Layout\x1b[0m\n');
  console.log(`  Project root: ${absRoot}\n`);

  const candidates = [
    { src: 'docs/guides',   dst: '.rdc/guides'   },
    { src: 'docs/plans',    dst: '.rdc/plans'     },
    { src: 'docs/reports',  dst: '.rdc/reports'   },
    { src: 'docs/research', dst: '.rdc/research'  },
  ];
  const found = candidates.filter(c => fs.existsSync(path.join(absRoot, c.src)));
  if (found.length === 0) { info('No migratable directories found.'); rl.close(); return; }

  console.log('  Found:');
  found.forEach(c => console.log(`    ${c.src}`));
  console.log('');

  for (const c of found) {
    const srcAbs = path.join(absRoot, c.src);
    const dstAbs = path.join(absRoot, c.dst);
    const answer = await prompt(rl, `  Move ${c.src} → ${c.dst}? [Y/n]: `);
    if (answer.toLowerCase() === 'n') { info(`Skipped ${c.src}`); continue; }
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

  console.log('');
  console.log('  \x1b[32m╔══════════════════════════════╗\x1b[0m');
  console.log('  \x1b[32m║  rdc-skills Installer v0.7   ║\x1b[0m');
  console.log('  \x1b[32m╚══════════════════════════════╝\x1b[0m');
  console.log('');
  console.log(`  CLAUDE_HOME : ${claudeHome}`);
  console.log(`  Plugin root : ${repoRoot}`);
  console.log('');

  if (!fs.existsSync(claudeHome)) {
    err(`CLAUDE_HOME not found: ${claudeHome}`);
    process.exit(1);
  }

  // 0. Pull latest
  try {
    const before = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    execSync('git pull --ff-only', { cwd: repoRoot, stdio: 'pipe' });
    const after  = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    ok(`[0/3] Up to date  — ${before === after ? after.slice(0, 7) : `${before.slice(0,7)} → ${after.slice(0,7)}`}`);
  } catch {
    warn('[0/3] git pull failed — installing from local copy');
  }

  // 1. Plugin registration
  const { version, cacheDir } = registerPlugin();
  ok(`[1/3] Plugin      — rdc-skills@rdc-skills v${version} registered + enabled`);
  info(`       Cache      : ${cacheDir}`);

  // 2. Hook files
  const hookCount = copyDir(hooksSrc, hooksDst, '.js');
  ok(`[2/3] Hook files  — ${hookCount} file(s) → ${hooksDst}`);

  // 3. Hooks in settings.json
  if (skipHooks) {
    info('[3/3] Hook wiring — skipped (--skip-hooks)');
  } else {
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
    }
    settings.hooks = buildHooksConfig(hooksDst);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    ok(`[3/3] Hook wiring — registered in ${settingsPath}`);
  }

  // 4. Preflight
  console.log('');
  console.log('  \x1b[36mPreflight:\x1b[0m');
  runPreflight();

  // 5. Project scan + optional setup
  const projectRoot = projectArg || process.cwd();
  const detected = detectProjectInfo(projectRoot);
  let runSetup = doSetup;
  if (!runSetup && !detected._alreadyHasConfig && projectRoot !== repoRoot) {
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise(resolve => rl2.question(
      '\n  No .rdc/config.json found. Run setup interview? [Y/n]: ', resolve
    ));
    rl2.close();
    if (ans.trim().toLowerCase() !== 'n') runSetup = true;
  }

  // 6. Done + commands list
  console.log('');
  console.log('  \x1b[32mInstallation complete!\x1b[0m');
  console.log('');
  console.log('  \x1b[33mNext steps:\x1b[0m');
  console.log('  1. Restart Claude Code (picks up new plugin + hooks)');
  console.log('  2. Run /rdc:status to verify work queue');
  console.log('');

  listCommands();

  console.log('  Docs: https://github.com/LIFEAI/rdc-skills#readme');
  console.log('');
}

main().catch(e => { err(e.message); process.exit(1); });
