#!/usr/bin/env node
/**
 * foreground-process-gate.js — narrowed to Playwright headed/UI-mode only
 * (epic 688ad6da WP-4, lifeai-env). Four window-focus/process-launch checks
 * (checkWindowFocusApi, checkPowerShell, checkCmdStart, checkDirectShellLaunch)
 * were removed; the replacement is lifeai-env's lib/TermLaunch.psm1 caller-
 * logging, which lives in a different repo and is not this file's job to
 * re-implement or re-check.
 *
 * This file's job is now to prove two things stay true going forward:
 *   1. The four retired checks no longer block anything -- a real regression
 *      here would silently reintroduce ceremony an operator explicitly
 *      retired, with no other test anywhere positioned to catch it.
 *   2. checkPlaywright survives untouched (Design Decision D3) -- this is a
 *      SEPARATE safety property, not part of the terminal-launch
 *      consolidation, and narrowing the file must never have narrowed this.
 *
 * Run: node tests/foreground-process-gate.test.mjs
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOK = join(REPO_ROOT, 'hooks', 'foreground-process-gate.js');

const failures = [];
function assert(name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  else process.stdout.write(`  ok  ${name}\n`);
}

function runGate(command) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
  const blocked = res.status === 1;
  return { blocked, stdout: res.stdout, status: res.status };
}

// ===========================================================================
// 1. The four retired checks no longer block anything.
// ===========================================================================

{
  const r = runGate('Start-Process -FilePath node.exe -ArgumentList "server.js"');
  assert('Start-Process with no -WindowStyle Hidden no longer blocks (checkPowerShell retired)',
    r.blocked === false, `status=${r.status} stdout=${r.stdout}`);
}

{
  const r = runGate('cmd /c start node.exe server.js');
  assert('cmd /c start without /min no longer blocks (checkCmdStart retired)',
    r.blocked === false, `status=${r.status} stdout=${r.stdout}`);
}

{
  const r = runGate('powershell.exe -File C:\\Dev\\some-script.ps1');
  assert('bare PowerShell .ps1 launch no longer blocks (checkDirectShellLaunch retired)',
    r.blocked === false, `status=${r.status} stdout=${r.stdout}`);
}

{
  const r = runGate('[Win32]::SetForegroundWindow($handle)');
  assert('a window-focus Win32 API call no longer blocks (checkWindowFocusApi retired)',
    r.blocked === false, `status=${r.status} stdout=${r.stdout}`);
}

// ===========================================================================
// 2. checkPlaywright survives, untouched -- a separate safety property.
// ===========================================================================

{
  const r = runGate('npx playwright test --headed');
  assert('Playwright --headed still blocks',
    r.blocked === true, `status=${r.status} stdout=${r.stdout}`);
  assert('Playwright --headed block message names the right reason',
    /must run headless/.test(r.stdout), r.stdout);
}

{
  const r = runGate('PWDEBUG=1 npx playwright test');
  assert('Playwright PWDEBUG=1 still blocks',
    r.blocked === true, `status=${r.status} stdout=${r.stdout}`);
}

{
  const r = runGate('npx playwright show-report');
  assert('Playwright show-report still blocks',
    r.blocked === true, `status=${r.status} stdout=${r.stdout}`);
  assert('Playwright show-report block message names the right reason',
    /launches foreground UI/.test(r.stdout), r.stdout);
}

{
  const r = runGate('npx playwright test --reporter=list');
  assert('an ordinary headless Playwright run is NOT blocked',
    r.blocked === false, `status=${r.status} stdout=${r.stdout}`);
}

{
  const r = runGate('git status');
  assert('an unrelated ordinary command passes clean', r.blocked === false, `status=${r.status} stdout=${r.stdout}`);
}

// ===========================================================================
if (failures.length > 0) {
  console.error('\nforeground-process-gate tests — FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nforeground-process-gate tests — PASS');
