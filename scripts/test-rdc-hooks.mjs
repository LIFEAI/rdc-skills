#!/usr/bin/env node
// Behavioral smoke tests for the RDC marker and Stop output-contract hooks.

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MARKER_HOOK = join(REPO_ROOT, "hooks", "rdc-invocation-marker.js");
const STOP_HOOK = join(REPO_ROOT, "hooks", "rdc-output-contract-gate.js");

const tmpHome = mkdtempSync(join(tmpdir(), "rdc-hooks-"));
const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
const failures = [];

function markerPath(sessionId) {
  return join(tmpHome, ".claude", "rdc-active", `${sessionId}.json`);
}

function runHook(script, payload) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env,
  });
}

function assert(name, condition, detail = "") {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function readMarker(sessionId) {
  return JSON.parse(readFileSync(markerPath(sessionId), "utf8"));
}

try {
  const expansion = runHook(MARKER_HOOK, {
    hook_event_name: "UserPromptExpansion",
    session_id: "s-expansion",
    command_source: "plugin",
    command_name: "rdc:design",
    prompt: "/rdc:design palette audit",
  });
  assert("expansion exits zero", expansion.status === 0, expansion.stderr);
  assert("expansion emits context", /RDC CONTRACT ACTIVE/.test(expansion.stdout), expansion.stdout);
  assert("expansion writes marker", existsSync(markerPath("s-expansion")));
  assert("expansion marker event preserved", readMarker("s-expansion").hook_event_name === "UserPromptExpansion");

  const builtin = runHook(MARKER_HOOK, {
    hook_event_name: "UserPromptExpansion",
    session_id: "s-builtin",
    command_source: "builtin",
    command_name: "help",
    prompt: "/help",
  });
  assert("builtin exits zero", builtin.status === 0, builtin.stderr);
  assert("builtin emits no context", builtin.stdout.trim() === "", builtin.stdout);
  assert("builtin writes no marker", !existsSync(markerPath("s-builtin")));

  const submit1 = runHook(MARKER_HOOK, {
    hook_event_name: "UserPromptExpansion",
    session_id: "s-dedup",
    command_source: "plugin",
    command_name: "rdc:design",
    prompt: "/rdc:design button audit",
  });
  assert("dedup first mark exits zero", submit1.status === 0, submit1.stderr);
  const first = readMarker("s-dedup");
  const submit2 = runHook(MARKER_HOOK, {
    hook_event_name: "UserPromptSubmit",
    session_id: "s-dedup",
    prompt: "/rdc:design button audit",
  });
  assert("dedup second mark exits zero", submit2.status === 0, submit2.stderr);
  const second = readMarker("s-dedup");
  assert("dedup preserves started_at", second.started_at === first.started_at);
  assert("dedup preserves hook event", second.hook_event_name === "UserPromptExpansion");

  const genericHelp = runHook(MARKER_HOOK, {
    hook_event_name: "UserPromptSubmit",
    session_id: "s-help",
    prompt: "/help",
  });
  assert("generic help exits zero", genericHelp.status === 0, genericHelp.stderr);
  assert("generic help writes no marker", !existsSync(markerPath("s-help")));

  const noMarker = runHook(STOP_HOOK, {
    hook_event_name: "Stop",
    session_id: "s-no-marker",
    last_assistant_message: "plain chat",
  });
  assert("stop without marker exits zero", noMarker.status === 0, noMarker.stderr);
  assert("stop without marker is silent", noMarker.stdout.trim() === "", noMarker.stdout);

  writeFileSync(markerPath("s-block"), JSON.stringify({
    session_id: "s-block",
    command: "design",
    started_at: new Date().toISOString(),
  }, null, 2));
  const blocked = runHook(STOP_HOOK, {
    hook_event_name: "Stop",
    session_id: "s-block",
    last_assistant_message: "No contract artifacts here.",
  });
  assert("noncompliant stop exits zero", blocked.status === 0, blocked.stderr);
  assert("noncompliant stop blocks", /"decision"\s*:\s*"block"/.test(blocked.stdout), blocked.stdout);
  assert("noncompliant stop retains marker", existsSync(markerPath("s-block")));

  const reentry = runHook(STOP_HOOK, {
    hook_event_name: "Stop",
    session_id: "s-block",
    stop_hook_active: true,
    last_assistant_message: "Still no contract artifacts.",
  });
  assert("stop reentry exits zero", reentry.status === 0, reentry.stderr);
  assert("stop reentry allows silent pass", reentry.stdout.trim() === "", reentry.stdout);
  assert("stop reentry clears marker", !existsSync(markerPath("s-block")));

  writeFileSync(markerPath("s-pass"), JSON.stringify({
    session_id: "s-pass",
    command: "review",
    started_at: new Date().toISOString(),
  }, null, 2));
  const compliant = runHook(STOP_HOOK, {
    hook_event_name: "Stop",
    session_id: "s-pass",
    last_assistant_message: "[x] Verified hook behavior\n\n✅ Complete in 2s",
  });
  assert("compliant stop exits zero", compliant.status === 0, compliant.stderr);
  assert("compliant stop is silent", compliant.stdout.trim() === "", compliant.stdout);
  assert("compliant stop clears marker", !existsSync(markerPath("s-pass")));
} finally {
  rmSync(tmpHome, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("\nrdc hook behavior tests — FAIL\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("rdc hook behavior tests — PASS");
