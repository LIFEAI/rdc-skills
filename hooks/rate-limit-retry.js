#!/usr/bin/env node
// Stop hook — detect rate limit and schedule retry via Windows Task Scheduler.
'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOME      = process.env.USERPROFILE || process.env.HOME;
const CLAUDE    = path.join(HOME, '.claude');
const FLAG      = path.join(CLAUDE, 'rate-limit.flag');
const LOG       = path.join(CLAUDE, 'stop-log.jsonl');
const RUNNER    = path.join(CLAUDE, 'hooks', 'rate-limit-retry.cmd');

function log(obj) {
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'); } catch (_) {}
}

let input = '';
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch (_) {}

  const isRateLimit =
    (data.stop_reason === 'rate_limit') ||
    JSON.stringify(data).toLowerCase().includes('rate limit') ||
    JSON.stringify(data).toLowerCase().includes('rate_limit');

  if (!isRateLimit) { process.exit(0); }

  // Write flag and schedule retry in 1 hour
  try { fs.writeFileSync(FLAG, JSON.stringify({ detected_at: new Date().toISOString() })); } catch (_) {}

  const next = new Date(Date.now() + 60 * 60 * 1000);
  const t = `${String(next.getHours()).padStart(2,'0')}:${String(next.getMinutes()).padStart(2,'0')}`;
  try {
    execSync(`schtasks /create /f /tn "ClaudeRateLimitRetry" /tr "\\"${RUNNER}\\"" /sc once /st ${t}`,
      { shell: 'cmd.exe', stdio: 'pipe' });
    log({ hook: 'rate-limit-retry', scheduled: t });
  } catch (e) {
    log({ hook: 'rate-limit-retry', error: String(e.message).slice(0, 200) });
  }
  process.exit(0);
});
