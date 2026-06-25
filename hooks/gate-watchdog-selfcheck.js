#!/usr/bin/env node
/**
 * gate-watchdog-selfcheck.js — Truth Gate 3.0 Layer 6 (gate watchdog).
 *
 * Registered on `SessionStart`. Per the Claude Code hooks reference,
 * `SessionStart` CANNOT block — so this watchdog is ADVISORY: it prints a loud
 * STOP-banner (like the existing agent-startup guard) when a Truth-Gate
 * component is missing or unregistered, but it always exits 0. A disabled or
 * absent gate is the ultimate bypass (R4); this watchdog surfaces that the
 * moment a session starts, before any work trusts the gate chain.
 *
 * It asserts three things are present + registered:
 *   1. work-item-exit-gate.js  — exists in the installed rdc-skills hooks AND is
 *      referenced by a registered hook command (PreToolUse).
 *   2. truth-gate.mjs          — exists in the repo's .claude/hooks AND is
 *      registered on Stop and SubagentStop in .claude/settings.json.
 *   3. the LIVE hookify plugin hooks.json — the plugin's OWN hooks manifest under
 *      ~/.claude/plugins/cache/.../hookify/<hash>/hooks/hooks.json.
 *      ⛔ It deliberately does NOT trust the dead ~/.claude/hooks/hookify-*.js
 *      wrappers — those point at an ORPHANED cache hash and are not the live
 *      enforcement path. The watchdog resolves the live manifest and (when both
 *      exist) warns if the dead wrappers point at a cache hash that differs from
 *      the live one (the exact drift that silently disables hookify).
 *
 * Test seam: the pure decision is `evaluateWatchdog(facts)` where `facts` is a
 * plain object of booleans/paths gathered by the side-effecting probes. The
 * banner text is produced by `renderBanner(findings)`. Both are exported and
 * have no filesystem/process dependency, so the missing-gate banner and the
 * all-present silent path are provable offline.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = process.env.RDC_TRUTH_GATE_REPO || 'C:/Dev/regen-root';
const HOOKS_DIR = __dirname; // installed rdc-skills hooks dir (where this file lives)

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

/** Serialize all hook command strings in a settings.json hooks object. */
function settingsCommandText(settings) {
  if (!settings || !settings.hooks || typeof settings.hooks !== 'object') return '';
  const parts = [];
  for (const event of Object.keys(settings.hooks)) {
    const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    for (const g of groups) {
      for (const h of Array.isArray(g.hooks) ? g.hooks : []) {
        if (h && typeof h.command === 'string') parts.push(`${event}::${h.command}`);
      }
    }
  }
  return parts.join('\n');
}

/** Is a hook command referenced for the given event in the serialized text? */
function registeredForEvent(commandText, event, needle) {
  return commandText.split('\n').some((line) => line.startsWith(`${event}::`) && line.includes(needle));
}

/**
 * Locate the LIVE hookify plugin hooks.json under the plugins cache. Returns the
 * resolved manifest path (the plugin's OWN hooks/hooks.json), or null. NEVER
 * returns one of the dead ~/.claude/hooks/hookify-*.js wrappers.
 */
function findLiveHookifyManifest(home) {
  const cacheRoot = path.join(home, '.claude', 'plugins', 'cache');
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() && e.name === 'hooks.json' && /hookify/i.test(full)) {
        found.push(full);
      }
    }
  };
  walk(cacheRoot, 0);
  return found.length > 0 ? found[0] : null;
}

/** Read the cache-hash a dead hookify wrapper points at (its PLUGIN_ROOT). null if none. */
function deadWrapperPluginRoot(home) {
  const wrapper = path.join(home, '.claude', 'hooks', 'hookify-stop.js');
  try {
    const src = fs.readFileSync(wrapper, 'utf8');
    const m = src.match(/PLUGIN_ROOT\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Gather the watchdog facts via side-effecting probes. Returns a plain facts
 * object consumed by the pure evaluator. Kept separate from evaluateWatchdog so
 * the decision logic is unit-testable without a filesystem.
 */
function gatherFacts({ home = os.homedir(), repoRoot = REPO_ROOT, hooksDir = HOOKS_DIR } = {}) {
  const exitGatePath = path.join(hooksDir, 'work-item-exit-gate.js');
  const truthGatePath = path.join(repoRoot, '.claude', 'hooks', 'truth-gate.mjs');
  const settingsPath = path.join(repoRoot, '.claude', 'settings.json');
  const settings = readJsonSafe(settingsPath);
  const commandText = settingsCommandText(settings);

  const liveHookifyManifest = findLiveHookifyManifest(home);
  const deadRoot = deadWrapperPluginRoot(home);
  // The live manifest's plugin-root dir (the parent of /hooks/hooks.json).
  const liveRoot = liveHookifyManifest
    ? path.dirname(path.dirname(liveHookifyManifest))
    : null;

  return {
    exitGateFileExists: fs.existsSync(exitGatePath),
    exitGateRegistered: registeredForEvent(commandText, 'PreToolUse', 'work-item-exit-gate.js'),
    truthGateFileExists: fs.existsSync(truthGatePath),
    truthGateOnStop: registeredForEvent(commandText, 'Stop', 'truth-gate.mjs'),
    truthGateOnSubagentStop: registeredForEvent(commandText, 'SubagentStop', 'truth-gate.mjs'),
    liveHookifyManifestExists: Boolean(liveHookifyManifest),
    liveHookifyManifestPath: liveHookifyManifest,
    // Drift: a dead wrapper that points at a different cache hash than the live one.
    deadWrapperRoot: deadRoot,
    liveHookifyRoot: liveRoot,
    deadWrapperPointsAtStaleCache: Boolean(
      deadRoot && liveRoot &&
      path.normalize(deadRoot).toLowerCase() !== path.normalize(liveRoot).toLowerCase(),
    ),
    // paths for the banner / log
    exitGatePath,
    truthGatePath,
    settingsPath,
  };
}

/**
 * Pure decision over the gathered facts. Returns an array of finding strings
 * (empty = all gates healthy). The live hookify check is explicitly the PLUGIN
 * manifest, not the dead wrappers.
 */
function evaluateWatchdog(facts = {}) {
  const findings = [];
  if (!facts.exitGateFileExists) {
    findings.push(`work-item-exit-gate.js is MISSING from the installed hooks (${facts.exitGatePath || '?'}).`);
  }
  if (!facts.exitGateRegistered) {
    findings.push('work-item-exit-gate.js is NOT registered on a PreToolUse hook in .claude/settings.json.');
  }
  if (!facts.truthGateFileExists) {
    findings.push(`truth-gate.mjs is MISSING from the repo (${facts.truthGatePath || '?'}).`);
  }
  if (!facts.truthGateOnStop) {
    findings.push('truth-gate.mjs is NOT registered on the Stop event in .claude/settings.json.');
  }
  if (!facts.truthGateOnSubagentStop) {
    findings.push('truth-gate.mjs is NOT registered on the SubagentStop event in .claude/settings.json.');
  }
  if (!facts.liveHookifyManifestExists) {
    findings.push(
      'The LIVE hookify plugin hooks.json could not be found under ~/.claude/plugins/cache/**/hookify/**/hooks/hooks.json. ' +
      'Hookify enforcement may be disabled. (The dead ~/.claude/hooks/hookify-*.js wrappers are NOT the live path and are not trusted here.)',
    );
  }
  if (facts.deadWrapperPointsAtStaleCache) {
    findings.push(
      `The dead ~/.claude/hooks/hookify-*.js wrappers point at an ORPHANED cache hash (${facts.deadWrapperRoot}) ` +
      `that differs from the live plugin (${facts.liveHookifyRoot}). The wrappers are stale; the live plugin manifest is authoritative.`,
    );
  }
  return findings;
}

/** Render the loud STOP-banner from findings. Empty findings → empty string. */
function renderBanner(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return '';
  const lines = findings.map((f) => `  ⛔ ${f}`).join('\n');
  return (
    '\n' +
    '════════════════════════════════════════════════════════════════════════\n' +
    '⛔⛔  TRUTH GATE WATCHDOG — A GATE IS MISSING OR UNREGISTERED  ⛔⛔\n' +
    '════════════════════════════════════════════════════════════════════════\n' +
    'The Truth Gate enforcement chain is INCOMPLETE for this session. A disabled\n' +
    'or unregistered gate is the ultimate closure bypass. Findings:\n\n' +
    lines + '\n\n' +
    'Repair before trusting any work-item closure this session:\n' +
    '  node C:/Dev/rdc-skills/scripts/install-rdc-skills.js   (reinstall the hooks)\n' +
    '  then verify .claude/settings.json registers truth-gate.mjs on Stop+SubagentStop\n' +
    '  and work-item-exit-gate.js on PreToolUse.\n' +
    '════════════════════════════════════════════════════════════════════════\n'
  );
}

function main() {
  // Drain stdin if present (SessionStart delivers JSON); we don't need its body.
  try {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => finish());
    process.stdin.resume();
    // If no stdin arrives quickly, finish anyway (SessionStart may pass nothing).
    setTimeout(finish, 1500);
  } catch (_) {
    finish();
  }
}

let _finished = false;
function finish() {
  if (_finished) return;
  _finished = true;
  let findings = [];
  try {
    findings = evaluateWatchdog(gatherFacts());
  } catch (e) {
    // Even the watchdog crashing must not block the session — advisory only.
    findings = [`gate-watchdog self-check crashed: ${e && e.message ? e.message : String(e)}`];
  }
  const banner = renderBanner(findings);
  if (banner) {
    // SessionStart context output via systemMessage; also emit to stderr so it
    // is visible like the agent-startup guard. ADVISORY — always exit 0.
    process.stdout.write(JSON.stringify({ systemMessage: banner }));
    process.stderr.write(banner);
  }
  process.exit(0); // SessionStart cannot block — never exit non-zero.
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    evaluateWatchdog,
    renderBanner,
    gatherFacts,
    findLiveHookifyManifest,
    settingsCommandText,
    registeredForEvent,
  };
}
