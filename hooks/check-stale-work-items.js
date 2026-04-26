#!/usr/bin/env node
// SessionStart hook — non-blocking check for stale in_progress work items.
'use strict';
const { execSync } = require('child_process');

let input = '';
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  try {
    // Fire and forget — non-blocking, no output needed
    execSync(
      'curl -s --max-time 5 http://127.0.0.1:52437/ping',
      { stdio: 'pipe', timeout: 6000 }
    );
  } catch (_) {}
  process.exit(0);
});
