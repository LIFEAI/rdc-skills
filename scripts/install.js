#!/usr/bin/env node
/**
 * rdc-skills installer (Node.js — works from bash, PowerShell, or cmd)
 *
 * Usage:
 *   node scripts/install.js                        ← run from inside your project
 *   node scripts/install.js --project /path/to/project
 *   node scripts/install.js --skip-hooks
 *   node scripts/install.js --claude-home /path/to/.claude
 *   node scripts/install.js --setup                ← interactive setup interview
 *   node scripts/install.js --migrate .            ← migrate docs/ dirs to .rdc/
 *   node scripts/install.js --migrate /path/to/project
 *
 * NOTE: Run from inside your project root, or pass --project <path>.
 * The installer scans that directory to auto-detect project config.
 */

const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const readline = require('readline');
const { execSync } = require('child_process');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
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
const skillsSrc = path.join(repoRoot, 'skills');
const hooksSrc  = path.join(repoRoot, 'hooks');
const skillsDst = path.join(claudeHome, 'skills', 'user');
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
  const files = fs.readdirSync(src).filter(f => f.endsWith(ext));
  files.forEach(f => fs.copyFileSync(path.join(src, f), path.join(dst, f)));
  return files.length;
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Hook config template ──────────────────────────────────────────────────────
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
      cmd('rate-limit-retry.js',    'Checking for rate limits...'),
      cmd('post-work-check.js',     'Checking for undocumented work...'),
      cmd('no-stop-open-epics.js',  'Checking for open epics...'),
    ]}],
  };
}

// ── .rdc/config.json generator ────────────────────────────────────────────────
function buildConfigJson(answers, opts = {}) {
  const slug = slugify(answers.projectName || path.basename(answers.projectRoot || process.cwd()));
  const useWorkItems = (answers.useWorkItems || 'y').toLowerCase() !== 'n';

  const cfg = {
    name: slug,
    version: '1.0.0',
    description: answers.description || '',
    rdc_skills_version: '>=0.1.0',
    hook_scope: answers.epicScope || slug,
    git: {
      org:                answers.githubOrg    || '',
      repo:               answers.githubRepo   || slug,
      main_branch:        answers.mainBranch   || 'main',
      dev_branch:         answers.devBranch    || 'develop',
      auto_commit_branch: answers.devBranch    || 'develop',
    },
  };

  if (answers.supabaseRef) {
    cfg.supabase = {
      ref:        answers.supabaseRef,
      url:        `https://${answers.supabaseRef}.supabase.co`,
      mcp_server: 'mcp__claude_ai_Supabase__execute_sql',
    };
  }

  cfg.credentials = {
    provider:   'clauth',
    daemon_url: 'http://127.0.0.1:52437',
    env_paths:  ['.env.local'],
  };

  cfg.repos = [
    { path: '.', role: 'primary', description: answers.projectName || slug },
  ];

  cfg.paths = {
    guides:   opts.guides   || '.rdc/guides',
    plans:    opts.plans    || '.rdc/plans',
    reports:  opts.reports  || '.rdc/reports',
    research: opts.research || '.rdc/research',
    state:    '.rdc/state',
    systems:  'docs/systems',
  };

  cfg.work_items = { enabled: useWorkItems };

  cfg.constraints = {
    forbidden_commands: answers.forbiddenCommands
      ? answers.forbiddenCommands.split(',').map(s => s.trim()).filter(Boolean)
      : ['pnpm build'],
    typecheck_command: answers.typecheckCommand || 'npx tsc --noEmit',
    test_command:      answers.testCommand      || 'npx vitest run',
    never_push_to:     [answers.mainBranch || 'main'],
  };

  return cfg;
}

function writeConfigJson(projectRoot, cfg) {
  const rdcDir = path.join(projectRoot, '.rdc');
  fs.mkdirSync(rdcDir, { recursive: true });
  const cfgPath = path.join(rdcDir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return cfgPath;
}

// ── --migrate command ─────────────────────────────────────────────────────────
async function runMigrate(projectRoot) {
  const absRoot = path.resolve(projectRoot);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('');
  console.log('  \x1b[35m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║   rdc-skills — Migrate to .rdc/ Layout   ║\x1b[0m');
  console.log('  \x1b[35m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log(`  Project root: ${absRoot}`);
  console.log('');

  // Directories to scan
  const candidates = [
    { src: 'docs/guides',   dst: '.rdc/guides'   },
    { src: 'docs/plans',    dst: '.rdc/plans'     },
    { src: 'docs/reports',  dst: '.rdc/reports'   },
    { src: 'docs/research', dst: '.rdc/research'  },
  ];

  const found = candidates.filter(c => fs.existsSync(path.join(absRoot, c.src)));

  if (found.length === 0) {
    info('No migratable directories found (docs/guides, docs/plans, docs/reports, docs/research).');
    rl.close();
    return;
  }

  console.log('  Found the following directories:');
  found.forEach(c => console.log(`    ${c.src}`));
  console.log('');

  const moved = [];
  const skipped = [];

  for (const c of found) {
    const srcAbs = path.join(absRoot, c.src);
    const dstAbs = path.join(absRoot, c.dst);

    const answer = await prompt(rl, `  Move ${c.src} → ${c.dst}? [Y/n]: `);
    if (answer.toLowerCase() === 'n') {
      skipped.push(c.src);
      info(`Skipped ${c.src}`);
      continue;
    }

    // If destination already exists, merge files into it
    if (fs.existsSync(dstAbs)) {
      warn(`${c.dst} already exists — merging files`);
      const files = fs.readdirSync(srcAbs);
      files.forEach(f => {
        const srcFile = path.join(srcAbs, f);
        const dstFile = path.join(dstAbs, f);
        if (!fs.existsSync(dstFile)) {
          fs.renameSync(srcFile, dstFile);
        } else {
          warn(`  Skipped ${f} (already exists in ${c.dst})`);
        }
      });
      // Remove src dir if now empty
      try {
        const remaining = fs.readdirSync(srcAbs);
        if (remaining.length === 0) fs.rmdirSync(srcAbs);
      } catch {}
    } else {
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      fs.renameSync(srcAbs, dstAbs);
    }

    moved.push(c);
    ok(`Moved ${c.src} → ${c.dst}`);
  }

  // Generate .rdc/config.json if not present
  const cfgPath = path.join(absRoot, '.rdc', 'config.json');
  if (!fs.existsSync(cfgPath)) {
    const genCfg = await prompt(rl, '\n  .rdc/config.json not found. Generate a minimal one? [Y/n]: ');
    if (genCfg.toLowerCase() !== 'n') {
      // Detect basic git info
      let githubOrg = '';
      let githubRepo = '';
      try {
        const remote = execSync('git remote get-url origin', { cwd: absRoot, encoding: 'utf8' }).trim();
        const m = remote.match(/[:/]([^/]+)\/([^/.]+)(\.git)?$/);
        if (m) { githubOrg = m[1]; githubRepo = m[2]; }
      } catch {}

      const pathConfig = {};
      moved.forEach(c => { pathConfig[c.dst.replace('.rdc/', '')] = c.dst; });
      skipped.forEach(s => { const k = s.replace('docs/', ''); pathConfig[k] = s; });

      const cfg = buildConfigJson(
        {
          projectName:  path.basename(absRoot),
          projectRoot:  absRoot,
          githubOrg,
          githubRepo,
          epicScope:    slugify(path.basename(absRoot)),
        },
        pathConfig
      );

      const written = writeConfigJson(absRoot, cfg);
      ok(`Generated ${path.relative(absRoot, written)}`);
    }
  } else {
    info('.rdc/config.json already exists — skipped');
  }

  rl.close();

  // Summary
  console.log('');
  console.log('  \x1b[32mMigration summary:\x1b[0m');
  if (moved.length)   moved.forEach(c => console.log(`    \x1b[32m✓\x1b[0m Moved    ${c.src} → ${c.dst}`));
  if (skipped.length) skipped.forEach(s => console.log(`    \x1b[33m→\x1b[0m Skipped  ${s}`));
  console.log('');
  console.log('  Update .gitignore if .rdc/ should be ignored, or commit the new layout.');
  console.log('');
}

// ── Setup interview ───────────────────────────────────────────────────────────
async function setupInterview(detected = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const d = detected; // shorthand

  // Helper: show detected value as default in bracket
  const q = (label, key, fallback = '') => {
    const def = d[key] || fallback;
    return prompt(rl, def ? `  ${label} [${def}]: ` : `  ${label}: `);
  };
  const ans = async (label, key, fallback = '') => {
    const val = await q(label, key, fallback);
    return val || d[key] || fallback;
  };

  console.log('');
  console.log('  \x1b[35m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║   rdc-skills — Project Setup Interview   ║\x1b[0m');
  console.log('  \x1b[35m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  This will generate your project overlay guides and .rdc/config.json.');
  if (Object.keys(d).filter(k => !k.startsWith('_')).length > 0) {
    console.log('  \x1b[32mAuto-detected values shown in [brackets] — press Enter to accept.\x1b[0m');
  } else {
    console.log('  Press Enter to skip any question (use plugin defaults).');
  }
  console.log('');

  const answers = {};

  // Project basics
  answers.projectName   = await ans('Project name', 'projectName');
  answers.projectRoot   = await ans('Absolute path to project root', 'projectRoot', projectArg || process.cwd());
  answers.description   = await ans('Short description', 'description');
  answers.githubOrg     = await ans('GitHub org/user', 'githubOrg');
  answers.githubRepo    = await ans('GitHub repo name', 'githubRepo');
  answers.mainBranch    = await ans('Main branch', 'mainBranch', 'main');
  answers.devBranch     = await ans('Dev branch', 'devBranch', 'develop');

  console.log('');
  console.log('  \x1b[33m-- Database --\x1b[0m');
  answers.supabaseRef   = await ans('Supabase project ref (blank to skip)', 'supabaseRef');
  answers.useWorkItems  = await ans('Use work_items RPC for task tracking?', 'useWorkItems', 'Y');

  console.log('');
  console.log('  \x1b[33m-- Frontend --\x1b[0m');
  answers.uiPackage     = await ans('UI package name (blank for shadcn)', 'uiPackage');
  answers.tailwind      = await ans('Using Tailwind CSS?', 'tailwind', 'Y');

  console.log('');
  console.log('  \x1b[33m-- Deployment --\x1b[0m');
  answers.deployPlatform = await ans('Deploy platform (coolify/vercel/railway/other)', 'deployPlatform');
  answers.deployDomain   = await ans('Deploy dashboard URL', 'deployDomain');

  console.log('');
  console.log('  \x1b[33m-- Hooks --\x1b[0m');
  answers.epicScope     = await ans('Folder name to scope stop-hook to', 'epicScope');

  console.log('');
  console.log('  \x1b[33m-- Directory convention --\x1b[0m');
  answers.useRdcDir     = await ans('Use .rdc/ directory convention?', 'useRdcDir', 'Y');

  rl.close();

  return answers;
}

function generateOverlayGuides(answers, projectRoot) {
  const useRdc = (answers.useRdcDir || 'y').toLowerCase() !== 'n';

  // Determine guides directory
  const guidesDir = useRdc
    ? path.join(projectRoot, '.rdc', 'guides')
    : path.join(projectRoot, 'docs', 'guides');

  fs.mkdirSync(guidesDir, { recursive: true });

  const bootstrapPath = path.join(guidesDir, 'agent-bootstrap.md');
  if (!fs.existsSync(bootstrapPath)) {
    const supabaseSection = answers.supabaseRef
      ? `## Supabase\nProject ref: \`${answers.supabaseRef}\`\nUse \`mcp__claude_ai_Supabase__execute_sql\` — no \`project_id\` param needed.\n`
      : `## Supabase\n<!-- Add your Supabase project ref here -->\n`;

    const workItemsSection = (answers.useWorkItems || '').toLowerCase() !== 'n'
      ? `## Work Items\nAll tasks tracked in Supabase \`work_items\` via RPC.\n\`\`\`sql\nSELECT get_open_epics();  -- check queue at session start\nSELECT insert_work_item(p_title := '...', p_priority := 'high');\nSELECT update_work_item_status('<id>'::uuid, 'done');\n\`\`\`\nCreate work items BEFORE starting work. Never create-and-close after the fact.\n`
      : '';

    const relGuides = path.relative(projectRoot, guidesDir).replace(/\\/g, '/');

    fs.writeFileSync(bootstrapPath, `# Agent Bootstrap — ${answers.projectName || 'Project'}
> Project overlay — extends rdc-skills base guide.
> Generated by rdc-skills installer.

## Credentials
Get credentials via clauth daemon:
\`\`\`bash
curl -s http://127.0.0.1:52437/get/<service>
\`\`\`
Ping first: \`curl -s http://127.0.0.1:52437/ping\`

## Git Rules
- **Branch:** \`${answers.devBranch}\` for all work. \`${answers.mainBranch}\` = production (explicit approval required).
- **GitHub org:** ${answers.githubOrg || '<!-- your org -->'}
- Auto-commit to \`${answers.devBranch}\` after every logical block. Push. Never force-push.
- Commit format: \`type(scope): description\\n\\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>\`

${supabaseSection}
${workItemsSection}
## Completion Report
After finishing work, output:
\`\`\`
## Work Summary
- Files changed: <list>
- Tests: <pass/fail>
- Work items updated: <list>
- Committed: <sha>
\`\`\`
`);
    ok(`Generated ${relGuides}/agent-bootstrap.md`);
  } else {
    const relGuides = path.relative(projectRoot, guidesDir).replace(/\\/g, '/');
    info(`${relGuides}/agent-bootstrap.md already exists — skipped`);
  }

  // Generate .rdc/config.json if using .rdc/ convention
  if (useRdc) {
    const cfgPath = path.join(projectRoot, '.rdc', 'config.json');
    if (!fs.existsSync(cfgPath)) {
      const cfg = buildConfigJson(answers);
      const written = writeConfigJson(projectRoot, cfg);
      ok(`Generated .rdc/config.json (hook_scope: "${cfg.hook_scope}")`);
    } else {
      info('.rdc/config.json already exists — skipped');
    }
  }

  // Update no-stop-open-epics.js scope guard
  const scopeSource = answers.epicScope || slugify(answers.projectName || '');
  if (scopeSource) {
    const hookPath = path.join(hooksDst, 'no-stop-open-epics.js');
    if (fs.existsSync(hookPath)) {
      let src = fs.readFileSync(hookPath, 'utf8');
      src = src.replace(
        /const PROJECT_SCOPE = '[^']*'/,
        `const PROJECT_SCOPE = '${scopeSource}'`
      );
      fs.writeFileSync(hookPath, src);
      ok(`Updated stop-hook scope guard → '${scopeSource}'`);
    }
  }
}

// ── Project auto-detection ────────────────────────────────────────────────────
function detectProjectInfo(projectRoot) {
  const detected = {};

  // package.json → name, description
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name)        detected.projectName  = pkg.name.replace(/^@[^/]+\//, '');
      if (pkg.description) detected.description  = pkg.description;
    } catch {}
  }

  // git remote → org, repo
  try {
    const remote = execSync('git remote get-url origin', { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    const m = remote.match(/[:/]([^/]+)\/([^/.]+)(\.git)?$/);
    if (m) { detected.githubOrg = m[1]; detected.githubRepo = m[2]; }
  } catch {}

  // git branches
  try {
    const branches = execSync('git branch -a', { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' });
    if (/\bdevelop\b/.test(branches)) detected.devBranch = 'develop';
    if (/\bmain\b/.test(branches))    detected.mainBranch = 'main';
    else if (/\bmaster\b/.test(branches)) detected.mainBranch = 'master';
  } catch {}

  // .env.local / apps/**/.env.local → Supabase ref
  const envCandidates = [
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env'),
  ];
  // Also scan apps/* for .env.local
  const appsDir = path.join(projectRoot, 'apps');
  if (fs.existsSync(appsDir)) {
    try {
      fs.readdirSync(appsDir).forEach(app => {
        envCandidates.push(path.join(appsDir, app, '.env.local'));
      });
    } catch {}
  }
  for (const envFile of envCandidates) {
    if (!fs.existsSync(envFile)) continue;
    try {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/NEXT_PUBLIC_SUPABASE_URL\s*=\s*https:\/\/([a-z0-9]+)\.supabase\.co/);
        if (m) { detected.supabaseRef = m[1]; break; }
      }
    } catch {}
    if (detected.supabaseRef) break;
  }

  // CLAUDE.md → hook_scope hint (look for folder name pattern)
  const claudeMd = path.join(projectRoot, 'CLAUDE.md');
  if (fs.existsSync(claudeMd)) {
    try {
      const md = fs.readFileSync(claudeMd, 'utf8');
      // Look for PROJECT_SCOPE mentions
      const m = md.match(/PROJECT_SCOPE[^\n]*?['"`]([^'"`]+)['"`]/);
      if (m) detected.epicScope = m[1];
    } catch {}
  }

  // .rdc/config.json already exists → read it for defaults
  const rdcCfg = path.join(projectRoot, '.rdc', 'config.json');
  if (fs.existsSync(rdcCfg)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(rdcCfg, 'utf8'));
      if (cfg.name)               detected.projectName  = cfg.name;
      if (cfg.hook_scope)         detected.epicScope    = cfg.hook_scope;
      if (cfg.git?.org)           detected.githubOrg    = cfg.git.org;
      if (cfg.git?.repo)          detected.githubRepo   = cfg.git.repo;
      if (cfg.git?.main_branch)   detected.mainBranch   = cfg.git.main_branch;
      if (cfg.git?.dev_branch)    detected.devBranch    = cfg.git.dev_branch;
      if (cfg.supabase?.ref)      detected.supabaseRef  = cfg.supabase.ref;
      detected._alreadyHasConfig = true;
    } catch {}
  }

  // Existing guides directory
  if (fs.existsSync(path.join(projectRoot, '.rdc', 'guides')))  detected.guidesDir = '.rdc/guides';
  else if (fs.existsSync(path.join(projectRoot, 'docs', 'guides'))) detected.guidesDir = 'docs/guides';

  return detected;
}

// ── Preflight checks ──────────────────────────────────────────────────────────
function runPreflight() {
  console.log('');
  console.log('  \x1b[36mPreflight checks:\x1b[0m');

  // Node.js version
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) {
    err(`Node.js >= 18 required — found v${process.versions.node}`);
    process.exit(1);
  } else {
    ok(`Node.js v${process.versions.node} (>= 18)`);
  }

  // clauth daemon
  try {
    execSync('curl -s --max-time 2 http://127.0.0.1:52437/ping', { stdio: 'pipe' });
    ok('clauth daemon is running');
  } catch {
    warn('clauth daemon not responding — run scripts/restart-clauth.bat to start it');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // --migrate runs independently (no install needed)
  if (doMigrate) {
    await runMigrate(migratePath);
    return;
  }

  console.log('');
  console.log('  \x1b[32mrdc-skills Installer\x1b[0m');
  console.log('  \x1b[32m====================\x1b[0m');
  console.log('');
  console.log(`  CLAUDE_HOME : ${claudeHome}`);
  console.log(`  Plugin root : ${repoRoot}`);
  console.log('');

  if (!fs.existsSync(claudeHome)) {
    err(`CLAUDE_HOME not found: ${claudeHome}`);
    process.exit(1);
  }

  // 0. Pull latest from git
  try {
    const before = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    execSync('git pull --ff-only', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
    const after  = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
    if (before !== after) {
      ok(`[0/3] Updated     — ${before.slice(0,7)} → ${after.slice(0,7)}`);
    } else {
      ok(`[0/3] Up to date  — ${after.slice(0,7)}`);
    }
  } catch {
    warn('[0/3] git pull failed — installing from local copy');
  }

  // 1. Skills
  const skillCount = copyDir(skillsSrc, skillsDst, '.md');
  ok(`[1/3] Skills      — ${skillCount} file(s) → ${skillsDst}`);

  // 2. Hook files
  const hookCount = copyDir(hooksSrc, hooksDst, '.js');
  ok(`[2/3] Hook files  — ${hookCount} file(s) → ${hooksDst}`);

  // 3. Register hooks in settings.json
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

  // 4. Preflight checks
  runPreflight();

  // 5. Scan project for existing config (always — used for auto-prompt and prefill)
  const projectRoot = projectArg || process.cwd();
  if (projectArg) info(`Project root  : ${projectRoot}`);
  const detected = detectProjectInfo(projectRoot);

  if (Object.keys(detected).filter(k => !k.startsWith('_')).length > 0) {
    console.log('');
    console.log('  \x1b[36mAuto-detected project info:\x1b[0m');
    if (detected.projectName)  info(`Project name  : ${detected.projectName}`);
    if (detected.githubOrg)    info(`GitHub        : ${detected.githubOrg}/${detected.githubRepo || '?'}`);
    if (detected.supabaseRef)  info(`Supabase ref  : ${detected.supabaseRef}`);
    if (detected.mainBranch)   info(`Branches      : ${detected.mainBranch} / ${detected.devBranch || 'develop'}`);
    if (detected.guidesDir)    info(`Guides found  : ${detected.guidesDir}`);
  }

  // 6. Setup interview — explicit flag, or auto-prompt when no config found
  let runSetup = doSetup;

  if (!runSetup && !detected._alreadyHasConfig) {
    console.log('');
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise(resolve => rl2.question(
      '  No .rdc/config.json found. Run setup interview now? [Y/n]: ', resolve
    ));
    rl2.close();
    if (ans.trim().toLowerCase() !== 'n') runSetup = true;
  }

  if (runSetup) {
    const answers = await setupInterview(detected);
    const root = answers.projectRoot || projectRoot;
    generateOverlayGuides(answers, root);
  }

  console.log('');
  console.log('  \x1b[32mInstallation complete!\x1b[0m');
  console.log('');
  if (!runSetup) {
    console.log('  Tip: run with --setup to re-run the project setup interview');
    console.log('  Tip: run with --migrate <path> to move docs/ dirs to .rdc/ layout');
    console.log('');
  }
  console.log('  Next steps:');
  console.log('  1. Open Claude Code in your project root');
  if (!detected._alreadyHasConfig) {
  console.log('  2. Run /rdc:setup  ← scans your project and generates .rdc/config.json + guides');
  console.log('  3. Run /rdc:status to see your work queue and verify everything is wired up');
  } else {
  console.log('  2. Run /rdc:status to see your work queue and verify everything is wired up');
  console.log('     (run /rdc:setup anytime to update your project config)');
  }
  console.log('');
  console.log('  Docs: https://github.com/LIFEAI/rdc-skills#readme');
  console.log('');
}

main().catch(e => { err(e.message); process.exit(1); });
