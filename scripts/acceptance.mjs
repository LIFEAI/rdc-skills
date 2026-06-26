#!/usr/bin/env node
/**
 * Build acceptance runner for touched rdc:* skills.
 *
 * Runs one sandboxed agent fixture per selected skill, records all observable
 * engine events/tool calls to JSONL, verifies manifest assertions, and writes a
 * Markdown report with lessons learned / next build optimizations.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAllManifests } from './lib/manifest-schema.mjs';
import { runManifest } from './lib/runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REPORTS_DIR = join(REPO_ROOT, '.rdc', 'reports');

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] || fallback : fallback;
};
const has = (name) => args.includes(name);

const ENGINE = arg('--engine', process.env.RDC_ACCEPTANCE_ENGINE || 'claude').toLowerCase();
const BASE = arg('--base', process.env.RDC_ACCEPTANCE_BASE || 'HEAD~1');
const PROJECT_CWD = resolve(arg('--project-root', process.env.REGEN_ROOT || process.cwd()));
const RUN_ID = arg('--run-id', `acceptance-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const PARALLEL = Math.max(1, parseInt(arg('--parallel', '1'), 10) || 1);
const CHANGED = has('--changed');
const STRICT_RECORDING = has('--strict-recording');
const ONLY_SKILLS = args
  .flatMap((v, i) => (v === '--skill' && args[i + 1] ? [args[i + 1]] : []))
  .map(normalizeSkillName);

function normalizeSkillName(name) {
  if (!name) return name;
  if (name.includes(':')) return name;
  if (name.startsWith('lifeai-')) return name;
  return `rdc:${name.replace(/^rdc-/, '')}`;
}

function sh(cmd, cmdArgs, cwd = REPO_ROOT) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function changedFiles(base) {
  try {
    const mergeBase = sh('git', ['merge-base', base, 'HEAD']);
    const out = sh('git', ['diff', '--name-only', `${mergeBase}..HEAD`]);
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    const out = sh('git', ['diff', '--name-only', base]);
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  }
}

function skillFromPath(file) {
  const p = file.replace(/\\/g, '/');
  const m = p.match(/^skills\/([^/]+)\//);
  if (!m || m[1] === 'tests') return null;
  return `rdc:${m[1]}`;
}

function touchedSkillsFromGit(base) {
  const skills = new Set();
  for (const file of changedFiles(base)) {
    const skill = skillFromPath(file);
    if (skill) skills.add(skill);
    const test = file.replace(/\\/g, '/').match(/^skills\/tests\/rdc-(.+)\.test\.json$/);
    if (test) skills.add(`rdc:${test[1]}`);
  }
  return [...skills].sort();
}

function parseJsonLines(text) {
  const events = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Non-JSON output is still captured in stdout/stderr previews.
    }
  }
  return events;
}

function findToolName(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.name === 'string') return value.name;
  if (typeof value.tool_name === 'string') return value.tool_name;
  if (typeof value.tool === 'string') return value.tool;
  if (typeof value.server_name === 'string' && typeof value.tool_name === 'string') {
    return `${value.server_name}.${value.tool_name}`;
  }
  return null;
}

function claudeToolCalls(stdout) {
  const calls = [];
  for (const event of parseJsonLines(stdout)) {
    const type = event.type || event.event || event.kind || '';
    const msg = event.message || event;
    const content = Array.isArray(msg.content) ? msg.content : Array.isArray(event.content) ? event.content : [];
    for (const item of content) {
      if (item?.type === 'tool_use') {
        calls.push({
          engine: 'claude',
          id: item.id || null,
          name: item.name || null,
          input: item.input || null,
          raw_type: type || 'tool_use',
        });
      }
    }
    if (/tool/i.test(type)) {
      const name = findToolName(event);
      calls.push({
        engine: 'claude',
        id: event.id || event.tool_use_id || null,
        name,
        input: event.input || event.arguments || event.params || null,
        raw_type: type,
      });
    }
  }
  return dedupeCalls(calls);
}

function assistantText(engine, stdout) {
  if (engine === 'codex') {
    const chunks = [];
    for (const event of parseJsonLines(stdout)) {
      if (event?.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        chunks.push(event.item.text);
      }
      if (event?.type === 'message' && typeof event.text === 'string') chunks.push(event.text);
    }
    return chunks.join('\n\n').trim() || String(stdout || '').trim();
  }
  if (engine !== 'claude') return String(stdout || '').trim();
  const resultEvents = parseJsonLines(stdout).filter((event) => event.type === 'result' && typeof event.result === 'string');
  if (resultEvents.length > 0) return resultEvents.at(-1).result.trim();
  const chunks = [];
  for (const event of parseJsonLines(stdout)) {
    const msg = event.message || event;
    const content = Array.isArray(msg.content) ? msg.content : Array.isArray(event.content) ? event.content : [];
    for (const item of content) {
      if (item?.type === 'text' && typeof item.text === 'string') chunks.push(item.text);
    }
    if (event.type === 'result' && typeof event.result === 'string') chunks.push(event.result);
  }
  return chunks.join('\n\n').trim();
}

function outputAssertionFailures(spec, rendered) {
  const failures = [];
  if (!spec || typeof spec !== 'object') return failures;
  if (Array.isArray(spec.output_contains)) {
    const missing = spec.output_contains.filter((s) => !rendered.includes(s));
    if (missing.length > 0) {
      failures.push({
        predicate: 'acceptance.output_contains',
        message: `missing output substrings: ${missing.map((s) => JSON.stringify(s)).join(', ')}`,
      });
    }
  }
  if (Array.isArray(spec.output_not_contains)) {
    const present = spec.output_not_contains.filter((s) => rendered.includes(s));
    if (present.length > 0) {
      failures.push({
        predicate: 'acceptance.output_not_contains',
        message: `forbidden output substrings present: ${present.map((s) => JSON.stringify(s)).join(', ')}`,
      });
    }
  }
  return failures;
}

function toolCallAssertionFailures(spec, toolCalls) {
  const failures = [];
  if (!spec || typeof spec !== 'object') return failures;
  const names = toolCalls.map((call) => call.name).filter(Boolean);
  if (Array.isArray(spec.tool_calls_include_any) && spec.tool_calls_include_any.length > 0) {
    const hit = spec.tool_calls_include_any.some((expected) => names.includes(expected));
    if (!hit) {
      failures.push({
        predicate: 'acceptance.tool_calls_include_any',
        message: `expected at least one tool call from: ${spec.tool_calls_include_any.join(', ')}; saw: ${names.join(', ') || '(none)'}`,
      });
    }
  }
  if (Array.isArray(spec.tool_calls_include_all) && spec.tool_calls_include_all.length > 0) {
    const missing = spec.tool_calls_include_all.filter((expected) => !names.includes(expected));
    if (missing.length > 0) {
      failures.push({
        predicate: 'acceptance.tool_calls_include_all',
        message: `missing required tool calls: ${missing.join(', ')}; saw: ${names.join(', ') || '(none)'}`,
      });
    }
  }
  if (Array.isArray(spec.tool_calls_argument_matches) && spec.tool_calls_argument_matches.length > 0) {
    for (const matcher of spec.tool_calls_argument_matches) {
      const tools = Array.isArray(matcher.tools) ? matcher.tools : [];
      const pattern = typeof matcher.pattern === 'string' ? matcher.pattern : '';
      if (tools.length === 0 || !pattern) continue;
      let re = null;
      try {
        re = new RegExp(pattern, 'i');
      } catch {
        failures.push({
          predicate: 'acceptance.tool_calls_argument_matches',
          message: `invalid matcher regex: ${pattern}`,
        });
        continue;
      }
      const hit = toolCalls.some((call) => tools.includes(call.name) && re.test(JSON.stringify(call.input || {})));
      if (!hit) {
        failures.push({
          predicate: 'acceptance.tool_calls_argument_matches',
          message: `expected one of ${tools.join(', ')} with arguments matching /${pattern}/`,
        });
      }
    }
  }
  return failures;
}

function codexToolCalls(stdout) {
  const calls = [];
  for (const event of parseJsonLines(stdout)) {
    const type = event.type || event.event || event.kind || '';
    const item = event.item || {};
    let name = findToolName(event) || findToolName(event.call) || findToolName(item);
    let input = event.input || event.arguments || event.params || event.call?.arguments || null;
    if (item.type === 'command_execution') {
      const command = String(item.command || '');
      if (/\brg(\.exe)?\b|ripgrep/i.test(command)) name = 'Grep';
      else if (/Get-ChildItem|\bdir\b|\bls\b/i.test(command)) name = 'Glob';
      else if (/Get-Content|\bcat\b|\btype\b/i.test(command)) name = 'Read';
      else name = 'Shell';
      input = { command };
    }
    if (/tool|function/i.test(type) || name) {
      calls.push({
        engine: 'codex',
        id: event.id || event.call_id || event.item_id || null,
        name,
        input,
        raw_type: type || null,
      });
    }
  }
  return dedupeCalls(calls);
}

function dedupeCalls(calls) {
  const seen = new Set();
  const out = [];
  for (const call of calls) {
    const key = JSON.stringify([call.engine, call.id, call.name, call.raw_type, call.input]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(call);
  }
  return out;
}

function extractToolCalls(engine, observed) {
  if (engine === 'claude') return claudeToolCalls(observed?.stdout || '');
  if (engine === 'codex') return codexToolCalls(`${observed?.stdout || ''}\n${observed?.stderr || ''}`);
  throw new Error(`unsupported engine: ${engine}`);
}

function writeJsonl(file, event) {
  appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

function markdownReport({ runId, engine, selected, results, jsonlPath, artifactDir, startedAt, durationMs }) {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const lines = [
    '---',
    'type: rdc-skill-acceptance-report',
    `run_id: ${runId}`,
    `engine: ${engine}`,
    `created_at: ${new Date().toISOString()}`,
    '---',
    '',
    `# RDC Skill Acceptance - ${runId}`,
    '',
    `Started: ${startedAt}`,
    `Duration: ${durationMs} ms`,
    `Evidence JSONL: ${jsonlPath}`,
    `Artifacts: ${artifactDir}`,
    '',
    `Summary: ${passed} passed, ${failed} failed, ${results.length} total.`,
    '',
    '## Skills',
    '',
  ];
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    lines.push(`- ${r.skill}: ${status}; tool calls=${r.tool_calls.length}; duration=${r.duration_ms || 0} ms`);
    if (r.artifacts?.assistant_text) lines.push(`  - output: ${r.artifacts.assistant_text}`);
    if (r.artifacts?.stdout) lines.push(`  - raw stream: ${r.artifacts.stdout}`);
    if (r.failures?.length) {
      for (const failure of r.failures) {
        lines.push(`  - ${failure.predicate || 'failure'}: ${failure.message || JSON.stringify(failure)}`);
      }
    }
  }
  lines.push('', '## Lessons Learned', '');
  const noToolCalls = results.filter((r) => r.pass && r.tool_calls.length === 0);
  if (noToolCalls.length > 0) {
    lines.push(`- ${noToolCalls.map((r) => r.skill).join(', ')} passed without observable tool calls. That may be valid for pure formatting/read-only skills, but build acceptance should decide whether those skills need a stricter artifact assertion.`);
  }
  if (failed > 0) {
    lines.push('- Failed skill runs should generate a focused fixture or assertion update before the next build wave is accepted.');
  }
  if (results.every((r) => r.tool_calls.length > 0)) {
    lines.push('- All selected skills emitted observable tool calls in the engine stream.');
  }
  lines.push('', '## Next Build Optimizations', '');
  lines.push('- Keep one fast manifest per rdc:* skill touched by a PR or build wave.');
  lines.push('- Add engine-specific parsers as new event formats appear instead of weakening the acceptance gate.');
  lines.push('- Promote recurring failure patterns into manifest assertions rather than relying on transcript review.');
  lines.push('', '## Selected Skills', '');
  for (const skill of selected) lines.push(`- ${skill}`);
  lines.push('');
  return lines.join('\n');
}

async function runPool(items, parallel, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, lane));
  return results;
}

async function main() {
  if (!['claude', 'codex'].includes(ENGINE)) {
    console.error(`unsupported --engine ${ENGINE}; expected claude or codex`);
    process.exit(2);
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const jsonlPath = join(REPORTS_DIR, `${RUN_ID}.jsonl`);
  const mdPath = join(REPORTS_DIR, `${RUN_ID}.md`);
  const artifactDir = join(REPORTS_DIR, RUN_ID);
  mkdirSync(artifactDir, { recursive: true });

  const selected = new Set(ONLY_SKILLS);
  if (CHANGED) for (const skill of touchedSkillsFromGit(BASE)) selected.add(skill);
  if (selected.size === 0) {
    console.error('no skills selected; pass --changed and/or --skill rdc:name');
    process.exit(2);
  }

  const manifests = loadAllManifests();
  const bySkill = new Map(manifests.filter((m) => m.ok && m.manifest).map((m) => [m.manifest.skill, m]));
  const missing = [...selected].filter((skill) => !bySkill.has(skill));
  for (const skill of missing) {
    writeJsonl(jsonlPath, { kind: 'missing_manifest', run_id: RUN_ID, skill });
  }
  if (missing.length > 0) {
    console.error(`missing acceptance manifest(s): ${missing.join(', ')}`);
    console.error(`evidence: ${jsonlPath}`);
    process.exit(1);
  }

  const selectedManifests = [...selected].sort().map((skill) => bySkill.get(skill).manifest);
  writeJsonl(jsonlPath, {
    kind: 'start',
    run_id: RUN_ID,
    engine: ENGINE,
    selected: selectedManifests.map((m) => m.skill),
    project_cwd: PROJECT_CWD,
  });

  const results = await runPool(selectedManifests, PARALLEL, async (manifest) => {
    writeJsonl(jsonlPath, { kind: 'skill_start', run_id: RUN_ID, skill: manifest.skill, prompt: manifest.fixture?.prompt });
    const result = await runManifest(manifest, {
      runId: RUN_ID,
      projectCwd: PROJECT_CWD,
      engine: ENGINE,
    });
    const toolCalls = result.observed ? extractToolCalls(ENGINE, result.observed) : [];
    const safeSkill = manifest.skill.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '');
    const stdoutPath = join(artifactDir, `${safeSkill}.stdout.jsonl`);
    const stderrPath = join(artifactDir, `${safeSkill}.stderr.txt`);
    const assistantPath = join(artifactDir, `${safeSkill}.assistant.md`);
    const rendered = assistantText(ENGINE, result.observed?.stdout || '');
    writeFileSync(stdoutPath, result.observed?.stdout || '');
    writeFileSync(stderrPath, result.observed?.stderr || '');
    writeFileSync(assistantPath, rendered || '');
    const failures = [
      ...(result.failures || []),
      ...outputAssertionFailures(manifest.acceptance, rendered),
      ...toolCallAssertionFailures(manifest.acceptance, toolCalls),
    ];
    const pass = failures.length === 0 && Boolean(result.pass) && (!STRICT_RECORDING || toolCalls.length > 0);
    if (result.pass && STRICT_RECORDING && toolCalls.length === 0) {
      failures.push({ predicate: 'tool_calls', message: 'strict recording requires at least one observable tool call' });
    }
    writeJsonl(jsonlPath, {
      kind: 'skill_result',
      run_id: RUN_ID,
      skill: manifest.skill,
      pass,
      duration_ms: result.duration_ms,
      tool_calls: toolCalls,
      failures,
      artifacts: {
        stdout: stdoutPath,
        stderr: stderrPath,
        assistant_text: assistantPath,
      },
      assistant_preview: rendered.slice(0, 2000),
      worktree: result.worktree || null,
      observed: {
        exit_code: result.observed?.exit_code,
        timed_out: result.observed?.timed_out,
        files_modified: result.observed?.files_modified || [],
        commits: result.observed?.commits || [],
        stdout_chars: result.observed?.stdout?.length || 0,
        stderr_chars: result.observed?.stderr?.length || 0,
      },
    });
    return {
      ...result,
      pass,
      failures,
      tool_calls: toolCalls,
      artifacts: {
        stdout: stdoutPath,
        stderr: stderrPath,
        assistant_text: assistantPath,
      },
      assistant_preview: rendered.slice(0, 2000),
    };
  });

  const durationMs = Date.now() - started;
  writeJsonl(jsonlPath, {
    kind: 'end',
    run_id: RUN_ID,
    duration_ms: durationMs,
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
  });
  writeFileSync(mdPath, markdownReport({
    runId: RUN_ID,
    engine: ENGINE,
    selected: selectedManifests.map((m) => m.skill),
    results,
    jsonlPath,
    artifactDir,
    startedAt,
    durationMs,
  }));

  const failed = results.filter((r) => !r.pass);
  console.log(`rdc skill acceptance: ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log(`evidence: ${jsonlPath}`);
  console.log(`report: ${mdPath}`);
  if (failed.length > 0) {
    for (const r of failed) console.log(`FAIL ${r.skill}: ${r.failures?.map((f) => f.message).join('; ') || r.error || 'unknown'}`);
    process.exit(1);
  }
}

export { assistantText, codexToolCalls, normalizeSkillName };

const isMain = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
