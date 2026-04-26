#!/usr/bin/env node
// PostCompact hook — write a brief for session restart context.
'use strict';
const fs   = require('fs');
const path = require('path');
const HOME = process.env.USERPROFILE || process.env.HOME;
const BRIEF = path.join(HOME, '.claude', 'restart-brief.md');

let input = '';
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  try {
    const ts = new Date().toISOString();
    fs.writeFileSync(BRIEF, `# Restart Brief\nGenerated: ${ts}\n\nContext compacted. Resume from work items queue.\n`);
  } catch (_) {}
  process.exit(0);
});
