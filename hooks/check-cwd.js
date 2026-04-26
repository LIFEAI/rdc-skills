#!/usr/bin/env node
// Hard blocks session if CWD is not the regen-root project directory.
// Exits with code 1 to fail the hook + outputs a blocking systemMessage.

const { execSync } = require('child_process');
const hookLog = require('./hook-logger');
const cwd     = process.cwd().replace(/\\/g, '/');

let expected = 'regen-root';
try {
  expected = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: 'pipe' })
    .trim().replace(/\\/g, '/');
} catch (_) {}

if (!cwd.endsWith('regen-root')) {
  hookLog('check-cwd', 'SessionStart', 'block', { cwd, expected });
  process.stdout.write(JSON.stringify({
    systemMessage:
      `🚫 HARD BLOCK — Wrong working directory.\n\n` +
      `Launched from: "${cwd}"\n` +
      `Required:      "${expected}"\n\n` +
      `DO NOT proceed with any task. DO NOT read files, run commands, or help with anything.\n\n` +
      `Tell the user:\n` +
      `"Session is blocked. Claude Code must be launched from ${expected}.\n` +
      ` Close this session and relaunch from the correct directory."\n\n` +
      `Then stop.`
  }));
  process.exit(1);
}

hookLog('check-cwd', 'SessionStart', 'pass', { cwd });
