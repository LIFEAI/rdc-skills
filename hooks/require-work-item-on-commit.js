#!/usr/bin/env node
/**
 * PreToolUse hook — block git commits without a linked work item.
 *
 * Fires before any Bash tool call. If the command contains "git commit",
 * checks whether a fixit.marker exists (fixit workflow is self-documenting)
 * OR the commit message references a work item ID or conventional type.
 *
 * BLOCKS the commit if:
 *   - No fixit.marker exists
 *   - Commit message has no work item reference AND no conventional commit type
 *
 * A "work item reference" is any of:
 *   - A UUID pattern (work item ID)
 *   - "#<issue>" reference
 *   - Conventional commit prefix: feat/fix/chore/refactor/test/docs/style/perf/ci/build
 */

const fs      = require('fs');
const path    = require('path');
const hookLog = require('./hook-logger');

const MARKER_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || 'C:/Users/DaveLadouceur',
  '.claude',
  'fixit.marker'
);

const CONVENTIONAL_TYPES = /^(feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert)(\(.+\))?:/i;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISSUE_REF = /#[a-zA-Z0-9-]+/;

function main() {
  let input = '';
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    let toolInput;
    try {
      toolInput = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    if (toolInput.tool_name !== 'Bash') {
      process.exit(0);
    }

    const command = toolInput.tool_input?.command || '';
    if (!command.includes('git commit')) {
      process.exit(0);
    }

    // fixit.marker means this is a self-documenting fixit session — allow
    if (fs.existsSync(MARKER_FILE)) {
      hookLog('require-work-item', 'PreToolUse', 'pass-fixit', {});
      process.exit(0);
    }

    // Extract -m "..." message from command
    const msgMatch = command.match(/-m\s+["']([^"']+)["']/s) ||
                     command.match(/-m\s+"([\s\S]+?)"\s*(?:&&|$)/);
    const msg = msgMatch ? msgMatch[1] : command;

    if (CONVENTIONAL_TYPES.test(msg.trim()) || UUID_PATTERN.test(msg) || ISSUE_REF.test(msg)) {
      hookLog('require-work-item', 'PreToolUse', 'pass', { msg: msg.slice(0, 80) });
      process.exit(0);
    }

    hookLog('require-work-item', 'PreToolUse', 'warn', { msg: msg.slice(0, 80) });
    // Warn only — never hard-block commits. A missing work item is informational,
    // not a blocker. Conventional commit format is sufficient self-documentation.
    process.stdout.write(JSON.stringify({
      systemMessage: `⚠️ Commit has no work item reference or conventional commit type.\n` +
        `Preferred format: fix(<scope>): <message> — proceeding anyway.`
    }));
    process.exit(0);
  });
}

main();
