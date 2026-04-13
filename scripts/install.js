#!/usr/bin/env node
/**
 * rdc-skills installer (Node.js — works from bash, PowerShell, or cmd)
 *
 * Usage:
 *   node scripts/install.js
 *   node scripts/install.js --skip-hooks
 *   node scripts/install.js --claude-home /path/to/.claude
 *   node scripts/install.js --setup    ← interactive setup interview
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const readline = require('readline');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const skipHooks  = args.includes('--skip-hooks');
const doSetup    = args.includes('--setup');
const homeIdx    = args.indexOf('--claude-home');
const claudeHome = homeIdx >= 0 ? args[homeIdx + 1] : path.join(os.homedir(), '.claude');

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

// ── Setup interview ───────────────────────────────────────────────────────────
async function setupInterview() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('');
  console.log('  \x1b[35m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║   rdc-skills — Project Setup Interview   ║\x1b[0m');
  console.log('  \x1b[35m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  This will help generate your project overlay guides.');
  console.log('  Press Enter to skip any question (use plugin defaults).');
  console.log('');

  const answers = {};

  // Project basics
  answers.projectName   = await prompt(rl, '  Project name (e.g. "My SaaS App"): ');
  answers.projectRoot   = await prompt(rl, '  Absolute path to project root (e.g. C:/Dev/my-app): ');
  answers.githubOrg     = await prompt(rl, '  GitHub org/user (e.g. LIFEAI): ');
  answers.mainBranch    = await prompt(rl, '  Main branch [main]: ') || 'main';
  answers.devBranch     = await prompt(rl, '  Dev branch [develop]: ') || 'develop';

  console.log('');
  console.log('  \x1b[33m-- Database --\x1b[0m');
  answers.supabaseRef   = await prompt(rl, '  Supabase project ref (e.g. abcdefghij): ');
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

  rl.close();

  return answers;
}

function generateOverlayGuides(answers, projectRoot) {
  const guidesDir = path.join(projectRoot, 'docs', 'guides');
  fs.mkdirSync(guidesDir, { recursive: true });

  const bootstrapPath = path.join(guidesDir, 'agent-bootstrap.md');
  if (!fs.existsSync(bootstrapPath)) {
    const supabaseSection = answers.supabaseRef
      ? `## Supabase\nProject ref: \`${answers.supabaseRef}\`\nUse \`mcp__claude_ai_Supabase__execute_sql\` — no \`project_id\` param needed.\n`
      : `## Supabase\n<!-- Add your Supabase project ref here -->\n`;

    const workItemsSection = (answers.useWorkItems || '').toLowerCase() !== 'n'
      ? `## Work Items\nAll tasks tracked in Supabase \`work_items\` via RPC.\n\`\`\`sql\nSELECT get_open_epics();  -- check queue at session start\nSELECT insert_work_item(p_title := '...', p_priority := 'high');\nSELECT update_work_item_status('<id>'::uuid, 'done');\n\`\`\`\nCreate work items BEFORE starting work. Never create-and-close after the fact.\n`
      : '';

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
    ok(`Generated docs/guides/agent-bootstrap.md`);
  } else {
    info(`docs/guides/agent-bootstrap.md already exists — skipped`);
  }

  // Update no-stop-open-epics.js scope guard if epicScope provided
  if (answers.epicScope) {
    const hookPath = path.join(hooksDst, 'no-stop-open-epics.js');
    if (fs.existsSync(hookPath)) {
      let src = fs.readFileSync(hookPath, 'utf8');
      src = src.replace(
        /const PROJECT_SCOPE = '[^']*'/,
        `const PROJECT_SCOPE = '${answers.epicScope}'`
      );
      fs.writeFileSync(hookPath, src);
      ok(`Updated stop-hook scope guard → '${answers.epicScope}'`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
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

  // 4. Optional setup interview
  let answers = {};
  if (doSetup) {
    answers = await setupInterview();
    const projectRoot = answers.projectRoot || process.cwd();
    if (answers.projectRoot) {
      generateOverlayGuides(answers, projectRoot);
    }
  }

  console.log('');
  console.log('  \x1b[32mInstallation complete!\x1b[0m');
  console.log('');
  if (!doSetup) {
    console.log('  Tip: run with --setup to generate project overlay guides interactively');
    console.log('');
  }
  console.log('  Next steps:');
  console.log('  1. Restart Claude Code (hooks take effect on next launch)');
  console.log('  2. Run /rdc:status to verify');
  console.log('  3. Add project overlay guides to docs/guides/ if not already present');
  console.log('');
  console.log('  Docs: https://github.com/LIFEAI/rdc-skills#readme');
  console.log('');
}

main().catch(e => { err(e.message); process.exit(1); });
