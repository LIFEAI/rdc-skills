#!/usr/bin/env node
// PreCompact hook — log compact event.
'use strict';
const fs = require('fs');
const LOG = (process.env.USERPROFILE || process.env.HOME) + '/.claude/stop-log.jsonl';
let input = '';
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), hook: 'precompact' }) + '\n'); } catch (_) {}
  process.exit(0);
});
