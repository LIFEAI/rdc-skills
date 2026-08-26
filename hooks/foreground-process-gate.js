#!/usr/bin/env node
/**
 * PreToolUse hook — blocks Playwright headed/UI-mode invocations only.
 *
 * NARROWED 2026-08-26 (epic 688ad6da WP-4, lifeai-env). This file used to
 * ALSO block every raw foreground process launch (Start-Process without
 * -WindowStyle Hidden, cmd /c start without /min, window-focus Win32 APIs,
 * bare PowerShell .ps1 launches) -- that entire class is retired per Dave's
 * direct operator instruction: "remove the PreToolUse foreground-window
 * guard entirely... replace it with caller-logging for traceability."
 * lifeai-env's lib/TermLaunch.psm1 (Invoke-TermLaunchHidden /
 * Invoke-TermLaunchInteractive) is the replacement -- it logs every caller
 * (script + line + argv) to C:/Dev/.logs BEFORE spawning, which is strictly
 * more informative than a hard block that told a caller only "add
 * -WindowStyle Hidden" and never recorded who asked.
 *
 * checkPlaywright is a SEPARATE, unrelated concern (Design Decision D3,
 * .rdc/plans/terminal-launch-consolidation.md in lifeai-env): agent
 * sessions must never pop an interactive Playwright UI. That has nothing to
 * do with terminal/process launch primitives, so it was deliberately kept
 * here rather than folded into caller-logging, which would have silently
 * dropped a real safety property this narrowing was never asked to remove.
 * The filename is legacy -- kept to avoid an unrelated hookify-manifest
 * rewire for a rename that changes nothing about what the file does.
 */
const hookLog = require('./hook-logger');

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.resume();
  });
}

function block(message, details = {}) {
  hookLog('foreground-process-gate', 'PreToolUse', 'block', details);
  process.stdout.write(JSON.stringify({
    systemMessage: `HARD BLOCK — Foreground process launch rejected.\n\n${message}`,
  }));
  process.exit(1);
}

function pass(details = {}) {
  hookLog('foreground-process-gate', 'PreToolUse', 'pass', details);
  process.exit(0);
}

function toolText(raw) {
  if (typeof raw.tool_input?.command === 'string') return raw.tool_input.command;
  if (typeof raw.tool_input === 'string') return raw.tool_input;
  try { return JSON.stringify(raw.tool_input || raw); } catch { return ''; }
}

function checkPlaywright(command) {
  if (!/\b(playwright|@playwright\/test)\b/i.test(command)) return;

  if (/\bplaywright\s+(show-report|codegen|open)\b/i.test(command)) {
    block(
      'Playwright report/codegen/open launches foreground UI. Use trace/report files as artifacts, or run a hidden/background smoke wrapper.',
      { kind: 'playwright-ui' },
    );
  }

  if (/(^|[\s;&|])(--headed|--ui|PWDEBUG\s*=\s*1|PWDEBUG\s*=\s*true)(?=$|[\s;&|])/i.test(command)) {
    block(
      'Playwright must run headless in agent sessions. Remove `--headed`, `--ui`, and `PWDEBUG=1`; use `--reporter=list` or an artifact trace instead.',
      { kind: 'playwright-headed' },
    );
  }
}

async function main() {
  let raw;
  try { raw = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const command = toolText(raw);
  if (!command) pass({ reason: 'no-command' });

  checkPlaywright(command);

  pass({ reason: 'clean' });
}

main().catch((e) => block(`Foreground process gate crashed: ${e.message}`));
