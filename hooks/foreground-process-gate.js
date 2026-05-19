#!/usr/bin/env node
/**
 * PreToolUse hook — block focus-stealing foreground process launches.
 */
'use strict';

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

function hasHiddenIntent(command) {
  return /-WindowStyle\s+Hidden/i.test(command) ||
    /-WindowStyle\s+Minimized/i.test(command) ||
    /windowsHide\s*:\s*true/i.test(command) ||
    /CreateNoWindow\s*=\s*\$?true/i.test(command) ||
    /Start-Job\b/i.test(command) ||
    /--background\b/i.test(command) ||
    /\bHEADLESS\s*=\s*(1|true)\b/i.test(command) ||
    /\bCI\s*=\s*(1|true)\b/i.test(command);
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

function checkPowerShell(command) {
  if (!/\bStart-Process\b/i.test(command)) return;
  if (hasHiddenIntent(command)) return;
  block(
    '`Start-Process` must include `-WindowStyle Hidden` or `-WindowStyle Minimized` for agent-launched node/cmd/ps1/test processes.',
    { kind: 'start-process' },
  );
}

function checkCmdStart(command) {
  if (!/\bcmd(?:\.exe)?\s+\/c\s+start\b/i.test(command)) return;
  if (/\bcmd(?:\.exe)?\s+\/c\s+start\s+(""|''|`"")?\s*\/(?:min|b)\b/i.test(command)) return;
  block(
    '`cmd /c start` must use `/min` for visible tools or `/b`/a hidden wrapper for background tools.',
    { kind: 'cmd-start' },
  );
}

function checkDirectShellLaunch(command) {
  if (hasHiddenIntent(command)) return;
  if (/\bpowershell(?:\.exe)?\b[^|\n]*(?:-File\s+[^|\n]*\.ps1|\.ps1\b)/i.test(command)) {
    block(
      'PowerShell script launches from agent tooling must use `-WindowStyle Hidden -NonInteractive` or a hidden wrapper.',
      { kind: 'powershell-ps1' },
    );
  }
}

async function main() {
  let raw;
  try { raw = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const command = toolText(raw);
  if (!command) pass({ reason: 'no-command' });

  checkPlaywright(command);
  checkPowerShell(command);
  checkCmdStart(command);
  checkDirectShellLaunch(command);

  pass({ reason: 'clean' });
}

main().catch((e) => block(`Foreground process gate crashed: ${e.message}`));
