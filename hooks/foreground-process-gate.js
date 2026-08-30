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

/**
 * The mitigator — OPTIONAL, because this hook crosses a repo boundary.
 *
 * EVERY BLOCK ROUTES THROUGH THE MITIGATOR (operator: "any block"). Audited
 * 2026-08-30: 9 PreToolUse hooks wired, only the two guard dispatchers called
 * mitigate(), so seven families refused with no repeat count and no
 * classification — the signal that caught rtp-steering-grep being wrong in
 * BOTH directions.
 *
 * This file ships in rdc-skills and installs to ~/.claude/hooks. The mitigator
 * lives in lifeai-env, which is a SEPARATE repo that a consumer of this package
 * may not have. So the import is best-effort and its absence is not an error:
 * the block still lands, it simply arrives unannotated. A refusal that depended
 * on a sibling repo being installed would be worse than no annotation at all.
 */
let mitigator = null;
async function loadMitigator() {
  try {
    const path = require('node:path');
    const fs = require('node:fs');
    const envRoot = process.env.LIFEAI_ENV || 'C:/Dev/lifeai-env';
    const file = path.join(envRoot, 'hooks', 'lib', 'guard-mitigator.mjs');
    if (!fs.existsSync(file)) return;          // no lifeai-env here — that is fine
    mitigator = await import(require('node:url').pathToFileURL(file).href);
  } catch { /* annotation is never load-bearing */ }
}

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

  let mitigation = '';
  try {
    if (mitigator) {
      // details.kind already distinguishes the two refusals, so the rule id is
      // taken from it rather than parsed out of the message — guard-mitigator
      // keys on (rule id, argv shape) and explicitly forbids reading wording.
      mitigation = mitigator.mitigationLine(mitigator.mitigate(
        {
          rule: `foreground-process-gate-${details.kind || 'unknown'}`,
          cmd: blockSubject,
          cwd: process.cwd(),
          dir: mitigator.blockLedgerDir(),
          sessionId: process.env.LIFEAI_SESSION_ID,
        },
        { evaluate: null },   // a headed-browser refusal has no command to re-evaluate
      ));
    }
  } catch { /* annotation is never load-bearing */ }

  process.stdout.write(JSON.stringify({
    systemMessage: `HARD BLOCK — Foreground process launch rejected.\n\n${message}${mitigation ? `\n\n${mitigation}` : ''}`,
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

let blockSubject = '';

async function main() {
  let raw;
  try { raw = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const command = toolText(raw);
  if (!command) pass({ reason: 'no-command' });

  // Preload BEFORE any check can block, so block() stays synchronous. The
  // subject is the command itself, so repeated attempts at the SAME shape
  // register as repeats rather than as unrelated events.
  await loadMitigator();
  blockSubject = command;

  checkPlaywright(command);

  pass({ reason: 'clean' });
}

main().catch((e) => block(`Foreground process gate crashed: ${e.message}`));
