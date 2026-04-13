#!/usr/bin/env node
/**
 * rdc-skills installer (Node.js — works from bash, PowerShell, or cmd)
 *
 * Usage:
 *   node scripts/install.js
 *   node scripts/install.js --skip-hooks
 *   node scripts/install.js --claude-home /path/to/.claude
 *   node scripts/install.js --setup          ← interactive setup interview
 *   node scripts/install.js --migrate .      ← migrate docs/ dirs to .rdc/
 *   node scripts/install.js --migrate /path/to/project
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
async function setupInterview() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('');
  console.log('  \x1b[35m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║   rdc-skills — Project Setup Interview   ║\x1b[0m');
  console.log('  \x1b[35m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  This will generate your project overlay guides and .rdc/config.json.');
  console.log('  Press Enter to skip any question (use plugin defaults).');
  console.log('');

  const answers = {};

  // Project basics
  answers.projectName   = await prompt(rl, '  Project name (e.g. "My SaaS App"): ');
  answers.projectRoot   = await prompt(rl, '  Absolute path to project root (e.g. C:/Dev/my-app): ');
  answers.description   = await prompt(rl, '  Short description: ');
  answers.githubOrg     = await prompt(rl, '  GitHub org/user (e.g. LIFEAI): ');
  answers.githubRepo    = await prompt(rl, '  GitHub repo name: ');
  answers.mainBranch    = await prompt(rl, '  Main branch [main]: ')    || 'main';
  answers.devBranch     = await prompt(rl, '  Dev branch [develop]: ')  || 'develop';

  console.log('');
  console.log('  \x1b[33m-- Database --\x1b[0m');
  answers.supabaseRef   = await prompt(rl, '  Supabase project ref (e.g. abcdefghij, or blank): ');
  answers.useWorkItems  = await prompt(rl, '  Use work_items RPC for task tracking? [Y/n]: ');

  console.log('');
  console.log('  \x1b[33m-- Frontend --\x1b[0m');
  answers.uiPackage     = await prompt(rl, '  UI package name (e.g. @myorg/ui, or blank for shadcn): ');
  answers.tailwind      = await prompt(rl, '  Using Tailwind CSS? [Y/n]: ');

  console.log('');
  console.log('  \x1b[33m-- Deployment --\x1b[0m');
  answers.deployPlatform = await prompt(rl, '  Deploy platform (coolify/vercel/railway/other): ');
  answers.deployDomain   = await prompt(rl, '  Deploy dashboard URL (e.g. https://deploy.myapp.com): ');

  console.log('');
  console.log('  \x1b[33m-- Hooks --\x1b[0m');
  answers.epicScope     = await prompt(rl, '  Folder name to scope stop-hook to (e.g. my-app): ');

  console.log('');
  console.log('  \x1b[33m-- Directory convention --\x1b[0m');
  answers.useRdcDir     = await prompt(rl, '  Use .rdc/ directory convention? [Y/n]: ');

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

  // .rdc/config.json in cwd
  const cfgPath = path.join(process.cwd(), '.rdc', 'config.json');
  if (fs.existsSync(cfgPath)) {
    ok('.rdc/config.json found');
  } else {
    info('.rdc/config.json not found — run with --setup to generate one');
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

  // 5. Optional setup interview
  if (doSetup) {
    const answers = await setupInterview();
    const projectRoot = answers.projectRoot || process.cwd();
    if (answers.projectRoot) {
      generateOverlayGuides(answers, projectRoot);
    }
  }

  console.log('');
  console.log('  \x1b[32mInstallation complete!\x1b[0m');
  console.log('');
  if (!doSetup) {
    console.log('  Tip: run with --setup to generate project overlay guides + .rdc/config.json');
    console.log('  Tip: run with --migrate <path> to move docs/ dirs to .rdc/ layout');
    console.log('');
  }
  console.log('  Next steps:');
  console.log('  1. Restart Claude Code (hooks take effect on next launch)');
  console.log('  2. Run /rdc:status to verify');
  console.log('  3. Add project overlay guides to .rdc/guides/ (or docs/guides/) if not present');
  console.log('');
  console.log('  Docs: https://github.com/LIFEAI/rdc-skills#readme');
  console.log('');
}

main().catch(e => { err(e.message); process.exit(1); });
