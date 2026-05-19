'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const logPath = path.join(os.homedir(), '.claude', 'hook-events.jsonl');

module.exports = function hookLog(hook, event, verdict, details = {}) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        hook,
        event,
        verdict,
        details,
      }) + '\n',
    );
  } catch (_) {
    // Hooks should never fail just because telemetry could not be written.
  }
};
