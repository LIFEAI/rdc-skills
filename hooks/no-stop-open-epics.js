#!/usr/bin/env node
/**
 * Stop hook — block Claude from stopping when open epics exist.
 *
 * Fires on every Stop event where Claude decided to end_turn.
 * Queries get_open_epics() via Supabase REST.
 * Only blocks if epics with status=todo exist — in_progress means another session owns them.
 * Only fires in the regen-root project (scope guard on event.cwd).
 *
 * Exit codes:
 *   0 = allow stop
 *   2 = block stop (todo epics remain)
 *
 * PROJECT CONFIG REQUIRED in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<key>
 *
 * PROJECT SCOPE in package.json or plugin config:
 *   "hookScope": "regen-root"   ← folder name that must appear in event.cwd
 */

const fs = require('fs');
const path = require('path');

// ── Config — override these per project ──────────────────────────────────────

const PROJECT_SCOPE = 'regen-root'; // only block in sessions inside this folder name
const OVERNIGHT_SENTINEL = 'C:/Dev/regen-root/.rdc/overnight.lock'; // only fire when this exists
const ENV_PATHS = [
  'C:/Dev/regen-root/apps/rdc-marketing-engine/.env.local',
  'C:/Dev/regen-root/.env.local',
];
const SUPABASE_URL = process.env.SUPABASE_URL || readEnvVar('NEXT_PUBLIC_SUPABASE_URL');

function readEnvVar(key) {
  for (const p of ENV_PATHS) {
    try {
      const contents = fs.readFileSync(p, 'utf8');
      const match = contents.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (match) return match[1].trim();
    } catch {}
  }
  return null;
}

async function getOpenEpics(anonKey, supabaseUrl) {
  const url = `${supabaseUrl}/rest/v1/rpc/get_open_epics`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0 && data[0].get_open_epics) {
    return data[0].get_open_epics;
  }
  if (Array.isArray(data)) return data;
  return [];
}

async function main() {
  let event = {};
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    event = JSON.parse(raw);
  } catch {}

  // Scope guard — only apply to sessions inside PROJECT_SCOPE folder
  const cwd = event.cwd || process.cwd();
  const normalised = cwd.replace(/\\/g, '/').toLowerCase();
  if (!normalised.includes(PROJECT_SCOPE.toLowerCase())) {
    process.exit(0);
  }

  // Overnight gate — only block when rdc:overnight is actively running.
  // The overnight skill creates this sentinel at start and removes it on exit.
  // Interactive sessions never see this file, so they stop freely.
  if (!fs.existsSync(OVERNIGHT_SENTINEL)) {
    process.exit(0);
  }

  // Only block Claude's own end_turn — never block user-forced stops
  const stopReason = event.stop_reason || event.reason || '';
  if (stopReason && stopReason !== 'end_turn') {
    process.exit(0);
  }

  const anonKey = readEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const supabaseUrl = SUPABASE_URL || readEnvVar('NEXT_PUBLIC_SUPABASE_URL');
  if (!anonKey || !supabaseUrl) {
    process.exit(0); // Can't verify — silent pass
  }

  let epics = [];
  try {
    epics = await getOpenEpics(anonKey, supabaseUrl);
  } catch {
    process.exit(0);
  }

  // Only block on todo — in_progress means another session already owns it
  const actionable = epics.filter(e => (e.status || '').toLowerCase() === 'todo');

  if (actionable.length === 0) {
    process.exit(0);
  }

  const titles = actionable.slice(0, 3).map(e => `  • [${e.priority}] ${e.title}`).join('\n');
  const more = actionable.length > 3 ? `\n  … and ${actionable.length - 3} more` : '';

  process.stderr.write(
    `\n🚫 STOP BLOCKED — ${actionable.length} open epic(s) remain in queue:\n${titles}${more}\n\n` +
    `Continue working. Pick the highest-priority epic and proceed.\n` +
    `Only stop when get_open_epics() returns empty.\n\n`
  );

  process.exit(2);
}

main().catch(() => process.exit(0));
