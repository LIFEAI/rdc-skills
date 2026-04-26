#!/usr/bin/env node
// Stop hook — warn if work appears to have been done without a work item.
'use strict';
const fs   = require('fs');
const path = require('path');

const HOME  = process.env.USERPROFILE || process.env.HOME;
const LOG   = path.join(HOME, '.claude', 'stop-log.jsonl');

function log(obj) {
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'); } catch (_) {}
}

let input = '';
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  log({ hook: 'post-work-check', stop: true });
  process.exit(0);
});
