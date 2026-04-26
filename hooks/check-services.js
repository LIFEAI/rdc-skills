#!/usr/bin/env node
// PostToolUse hook — non-blocking service health pass-through.
'use strict';
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => { process.exit(0); });
