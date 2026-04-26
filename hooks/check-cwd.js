#!/usr/bin/env node
// Hard blocks session if CWD is not C:\Dev\regen-root.
// Exits with code 1 to fail the hook + outputs a blocking systemMessage.

const hookLog  = require('./hook-logger');
const cwd      = process.cwd().replace(/\\/g, '/');
const expected = 'C:/Dev/regen-root';

if (!cwd.endsWith('regen-root')) {
  hookLog('check-cwd', 'SessionStart', 'block', { cwd, expected });
  process.stdout.write(JSON.stringify({
    systemMessage:
      `🚫 HARD BLOCK — Wrong working directory.\n\n` +
      `Launched from: "${cwd}"\n` +
      `Required:      "${expected}"\n\n` +
      `DO NOT proceed with any task. DO NOT read files, run commands, or help with anything.\n\n` +
      `Tell the user:\n` +
      `"Session is blocked. Claude Code must be launched from C:\\Dev\\regen-root.\n` +
      ` Close this session and relaunch from the correct directory."\n\n` +
      `Then stop.`
  }));
  process.exit(1);
}

hookLog('check-cwd', 'SessionStart', 'pass', { cwd });
