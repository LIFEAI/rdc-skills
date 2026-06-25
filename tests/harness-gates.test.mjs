#!/usr/bin/env node
/**
 * Truth Gate 3.0 — Layers 5+6 harness-gate tests (WP-5).
 *
 * Covers the three new hooks, fully offline (no DB, no brain, no clauth):
 *   task-completed-gate.js   — flag OFF no-op; flag ON + no/unsound closure BLOCK;
 *                              flag ON + sound closure PASS.
 *   post-tool-batch-gate.js  — flag OFF no-op; flag ON + stale worktree base FLAG;
 *                              flag ON + current base PASS.
 *   gate-watchdog-selfcheck  — STOP-banner when a gate file/registration absent;
 *                              silent when all present; checks the LIVE hookify
 *                              hooks.json (plugin manifest), not the dead wrappers.
 *
 * Run: node tests/harness-gates.test.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOKS = join(REPO_ROOT, 'hooks');
const require = createRequire(import.meta.url);

const failures = [];
function assert(name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  else process.stdout.write(`  ok  ${name}\n`);
}

function runHook(file, payload, extraEnv = {}) {
  return spawnSync(process.execPath, [join(HOOKS, file)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

const WI = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ===========================================================================
// 1. task-completed-gate.js
// ===========================================================================
{
  const tcg = require(join(HOOKS, 'task-completed-gate.js'));

  // pure: closureIsSound branches
  assert('TCG closureIsSound: null row → not ok', tcg.closureIsSound(null).ok === false);
  assert('TCG closureIsSound: not-done task → not ok',
    tcg.closureIsSound({ id: WI, item_type: 'task', status: 'review' }).ok === false);
  assert('TCG closureIsSound: done but witness:agent → not ok',
    tcg.closureIsSound({ id: WI, item_type: 'task', status: 'done', implementation_report: { codeflow_post: { witness: 'agent', commit: 'x', files_changed: ['f'], verification: [{ exit_code: 0 }] } } }).ok === false);
  const soundRow = {
    id: WI, item_type: 'task', status: 'done',
    implementation_report: { codeflow_post: { witness: 'validator-rerun', commit: 'c3189c9d58a37d648e9de4a6bcd7d46772053eea', files_changed: ['hooks/x.js'], verification: [{ exit_code: 0 }] } },
  };
  assert('TCG closureIsSound: full sound closure → ok', tcg.closureIsSound(soundRow).ok === true,
    tcg.closureIsSound(soundRow).reason || '');
  assert('TCG closureIsSound: epic done → ok',
    tcg.closureIsSound({ id: WI, item_type: 'epic', status: 'done' }).ok === true);

  // pure: extractWorkItemId
  assert('TCG extractWorkItemId: from field', tcg.extractWorkItemId({ work_item_id: WI }) === WI);
  assert('TCG extractWorkItemId: from blob', tcg.extractWorkItemId({ task: { note: `closes ${WI}` } }) === WI);
  assert('TCG extractWorkItemId: none → null', tcg.extractWorkItemId({ task: { note: 'no uuid' } }) === null);

  // pure: flagEnabledEnv default OFF
  {
    const prev = process.env.RDC_TRUTHGATE_TASKCOMPLETED;
    delete process.env.RDC_TRUTHGATE_TASKCOMPLETED;
    assert('TCG flag default OFF', tcg.flagEnabledEnv() === false);
    process.env.RDC_TRUTHGATE_TASKCOMPLETED = 'true';
    assert('TCG flag ON via env', tcg.flagEnabledEnv() === true);
    if (prev === undefined) delete process.env.RDC_TRUTHGATE_TASKCOMPLETED;
    else process.env.RDC_TRUTHGATE_TASKCOMPLETED = prev;
  }

  // process: flag OFF → no-op (exit 0, no block)
  {
    const r = runHook('task-completed-gate.js', { work_item_id: WI }, { RDC_TRUTHGATE_TASKCOMPLETED: '' });
    assert('TCG flag OFF → exit 0 no-op', r.status === 0, `status=${r.status} ${r.stderr}`);
  }

  // process: flag ON + no closure ref → BLOCK (exit 2)
  {
    const r = runHook('task-completed-gate.js', { task: { note: 'no uuid here' } },
      { RDC_TRUTHGATE_TASKCOMPLETED: '1' });
    assert('TCG flag ON + no work-item ref → exit 2 BLOCK', r.status === 2, `status=${r.status}`);
    assert('TCG block mentions no work-item reference', /no work-item reference/.test(r.stdout + r.stderr), r.stdout);
  }

  // process: flag ON + unsound closure (status review via sink) → BLOCK
  {
    const dir = mkdtempSync(join(tmpdir(), 'tcg-'));
    const sink = join(dir, 'closure.json');
    writeFileSync(sink, JSON.stringify({ id: WI, item_type: 'task', status: 'review', implementation_report: null }));
    const r = runHook('task-completed-gate.js', { work_item_id: WI },
      { RDC_TRUTHGATE_TASKCOMPLETED: '1', RDC_TASKCOMPLETED_CLOSURE_SINK: sink });
    assert('TCG flag ON + unsound closure → exit 2 BLOCK', r.status === 2, `status=${r.status} ${r.stdout}`);
    rmSync(dir, { recursive: true, force: true });
  }

  // process: flag ON + sound closure (via sink) → PASS (exit 0)
  {
    const dir = mkdtempSync(join(tmpdir(), 'tcg-'));
    const sink = join(dir, 'closure.json');
    writeFileSync(sink, JSON.stringify(soundRow));
    const r = runHook('task-completed-gate.js', { work_item_id: WI },
      { RDC_TRUTHGATE_TASKCOMPLETED: '1', RDC_TASKCOMPLETED_CLOSURE_SINK: sink });
    assert('TCG flag ON + sound closure → exit 0 PASS', r.status === 0, `status=${r.status} ${r.stdout}${r.stderr}`);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ===========================================================================
// 2. post-tool-batch-gate.js
// ===========================================================================
{
  const ptb = require(join(HOOKS, 'post-tool-batch-gate.js'));
  const DEV = 'c3189c9d58a37d648e9de4a6bcd7d46772053eea';
  const STALE = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const FRESH = '1234567812345678123456781234567812345678';

  // pure: evaluateWave — cannotEvaluate when no develop HEAD
  {
    const v = ptb.evaluateWave({ developHead: null, worktrees: [], isAncestor: () => true });
    assert('PTB evaluateWave: no develop HEAD → cannotEvaluate', v.cannotEvaluate === true && v.ok === false);
  }
  // pure: current base (develop is ancestor of worktree HEAD) → ok
  {
    const v = ptb.evaluateWave({
      developHead: DEV,
      worktrees: [{ path: '/wt/a', head: FRESH }],
      isAncestor: (a, b) => a === DEV && b === FRESH, // DEV is ancestor of FRESH
    });
    assert('PTB evaluateWave: current base → ok, no stale', v.ok === true && v.stale.length === 0);
  }
  // pure: worktree HEAD == develop HEAD → ok
  {
    const v = ptb.evaluateWave({
      developHead: DEV,
      worktrees: [{ path: '/wt/a', head: DEV }],
      isAncestor: () => false,
    });
    assert('PTB evaluateWave: head==develop → ok', v.ok === true && v.stale.length === 0);
  }
  // pure: stale base (develop NOT an ancestor) → flagged
  {
    const v = ptb.evaluateWave({
      developHead: DEV,
      worktrees: [{ path: '/wt/stale', head: STALE }],
      isAncestor: () => false, // DEV is NOT an ancestor of STALE
    });
    assert('PTB evaluateWave: stale base → not ok', v.ok === false, JSON.stringify(v));
    assert('PTB evaluateWave: stale worktree listed', v.stale.length === 1 && v.stale[0].head === STALE);
  }

  // process: flag OFF → no-op (exit 0)
  {
    const r = runHook('post-tool-batch-gate.js', { hook_event_name: 'PostToolBatch' },
      { RDC_TRUTHGATE_POSTTOOLBATCH: '' });
    assert('PTB flag OFF → exit 0 no-op', r.status === 0, `status=${r.status} ${r.stderr}`);
  }
}

// ===========================================================================
// 3. gate-watchdog-selfcheck.js
// ===========================================================================
{
  const wd = require(join(HOOKS, 'gate-watchdog-selfcheck.js'));

  const allPresent = {
    exitGateFileExists: true, exitGateRegistered: true,
    truthGateFileExists: true, truthGateOnStop: true, truthGateOnSubagentStop: true,
    liveHookifyManifestExists: true, deadWrapperPointsAtStaleCache: false,
  };
  // all present → no findings, empty banner (silent)
  {
    const findings = wd.evaluateWatchdog(allPresent);
    assert('WD all present → no findings', findings.length === 0, JSON.stringify(findings));
    assert('WD all present → empty banner (silent)', wd.renderBanner(findings) === '');
  }
  // truth-gate missing → finding + STOP banner
  {
    const findings = wd.evaluateWatchdog({ ...allPresent, truthGateFileExists: false });
    assert('WD truth-gate missing → finding', findings.some((f) => /truth-gate\.mjs is MISSING/.test(f)), JSON.stringify(findings));
    const banner = wd.renderBanner(findings);
    assert('WD truth-gate missing → STOP banner emitted', /TRUTH GATE WATCHDOG/.test(banner) && banner.length > 0);
  }
  // truth-gate unregistered on SubagentStop → finding
  {
    const findings = wd.evaluateWatchdog({ ...allPresent, truthGateOnSubagentStop: false });
    assert('WD truth-gate not on SubagentStop → finding', findings.some((f) => /SubagentStop/.test(f)));
  }
  // exit gate missing → finding
  {
    const findings = wd.evaluateWatchdog({ ...allPresent, exitGateFileExists: false });
    assert('WD exit-gate missing → finding', findings.some((f) => /work-item-exit-gate\.js is MISSING/.test(f)));
  }
  // LIVE hookify manifest absent → finding mentions plugin manifest, NOT dead wrappers as trusted
  {
    const findings = wd.evaluateWatchdog({ ...allPresent, liveHookifyManifestExists: false });
    const f = findings.find((x) => /hookify/i.test(x));
    assert('WD live hookify manifest absent → finding', Boolean(f), JSON.stringify(findings));
    assert('WD finding names the LIVE plugin hooks.json (not dead wrappers as trusted)',
      f && /plugins\/cache.*hookify.*hooks\.json/i.test(f) && /NOT the live path/i.test(f), f || '');
  }
  // dead wrapper points at stale cache → drift finding
  {
    const findings = wd.evaluateWatchdog({ ...allPresent, deadWrapperPointsAtStaleCache: true,
      deadWrapperRoot: '/cache/hookify/OLDHASH', liveHookifyRoot: '/cache/hookify/NEWHASH' });
    assert('WD stale-cache drift → finding', findings.some((f) => /ORPHANED cache hash/.test(f)));
  }

  // structural: gatherFacts inspects the LIVE plugins/cache hooks.json path, not the wrappers.
  {
    const home = mkdtempSync(join(tmpdir(), 'wd-home-'));
    const repo = mkdtempSync(join(tmpdir(), 'wd-repo-'));
    // Build a fake LIVE hookify plugin manifest under plugins/cache/.../hookify/<hash>/hooks/hooks.json
    const live = join(home, '.claude', 'plugins', 'cache', 'official', 'hookify', 'NEWHASH', 'hooks');
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, 'hooks.json'), JSON.stringify({ hooks: {} }));
    // Build a dead wrapper that points at a DIFFERENT (orphaned) hash.
    const deadDir = join(home, '.claude', 'hooks');
    mkdirSync(deadDir, { recursive: true });
    writeFileSync(join(deadDir, 'hookify-stop.js'),
      "const PLUGIN_ROOT = 'C:/cache/official/hookify/OLDHASH';\n");
    // Minimal settings.json registering both gates so those facts are true.
    mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'hooks', 'truth-gate.mjs'), '// stub');
    writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'node hooks/work-item-exit-gate.js' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/truth-gate.mjs' }] }],
        SubagentStop: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/truth-gate.mjs' }] }],
      },
    }));

    const manifest = wd.findLiveHookifyManifest(home);
    assert('WD findLiveHookifyManifest resolves the plugin hooks.json',
      typeof manifest === 'string' && /plugins[\\/]cache.*hookify.*hooks\.json$/i.test(manifest.replace(/\\/g, '/')), manifest || 'null');

    const facts = wd.gatherFacts({ home, repoRoot: repo, hooksDir: HOOKS });
    assert('WD gatherFacts: live hookify manifest detected', facts.liveHookifyManifestExists === true);
    assert('WD gatherFacts: dead wrapper stale-cache drift detected', facts.deadWrapperPointsAtStaleCache === true,
      `dead=${facts.deadWrapperRoot} live=${facts.liveHookifyRoot}`);
    assert('WD gatherFacts: truth-gate registered on Stop+SubagentStop',
      facts.truthGateOnStop === true && facts.truthGateOnSubagentStop === true);
    assert('WD gatherFacts: exit gate registered on PreToolUse', facts.exitGateRegistered === true);

    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

// ===========================================================================
if (failures.length > 0) {
  console.error('\nharness-gates tests — FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nharness-gates tests — PASS');
