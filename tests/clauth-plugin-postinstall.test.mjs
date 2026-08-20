#!/usr/bin/env node
/**
 * `scripts/postinstall.js` self-registers `clauth-plugin.json` with the local
 * clauth supervisor — and must NEVER be able to fail an install.
 *
 * The whole point of the file is its failure behaviour, so that is what is
 * asserted: absent clauth, non-zero register, a spawn that throws, and a
 * missing manifest all exit 0 with a printed hint. Also asserted is the path
 * anchor — during `npm i -g` the cwd is not the package root, so a
 * cwd-relative manifest path would resolve to nothing and silently no-op.
 *
 * Registration is STUBBED, never really invoked: the live managed-plugin root
 * (%APPDATA%/clauth/supervisor/managed-plugins) holds real registered plugins
 * that the running daemon reads, and a test has no business writing there.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const script = join(REPO_ROOT, 'scripts', 'postinstall.js');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- 0. wiring

const syntax = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);

const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
assert.equal(
  packageJson.scripts.postinstall,
  'node scripts/postinstall.js',
  'package.json must run the postinstall registrar on install',
);
assert.equal(
  existsSync(join(REPO_ROOT, 'clauth-plugin.json')),
  true,
  'the manifest the postinstall registers must exist in the repo',
);

const postinstall = require(script);

/** A spawnSync stub that records calls and replays canned results. */
function stubSpawn(results) {
  const calls = [];
  const queue = [...results];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const next = queue.shift();
    if (typeof next === 'function') return next();
    return next ?? { status: 0, stdout: '', stderr: '' };
  };
  return { spawn, calls };
}

function collectLog() {
  const lines = [];
  return { log: (line) => lines.push(String(line)), lines };
}

/**
 * A child env whose ONLY PATH entry is `dir`, so nothing named `clauth` can
 * resolve. Windows env vars are case-insensitive, so every existing spelling of
 * PATH has to be dropped first or the original one wins non-deterministically.
 */
function envWithOnlyPath(dir) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^path$/i.test(key) || key === postinstall.SKIP_ENV) continue;
    env[key] = value;
  }
  env.PATH = dir;
  return env;
}

// ------------------------------------------- 1. clauth absent -> exit 0 + hint
//
// Run the real script as a child with PATH stripped to an empty directory, so
// nothing named `clauth` can resolve. This is the end-to-end form of the
// contract: a box without clauth still gets a successful install.

const emptyPathDir = mkdtempSync(join(tmpdir(), 'rdc-postinstall-nopath-'));
try {
  const run = spawnSync(process.execPath, [script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: envWithOnlyPath(emptyPathDir),
  });
  assert.equal(run.status, 0, `postinstall must exit 0 without clauth on PATH:\n${run.stdout}\n${run.stderr}`);
  assert.match(
    run.stdout,
    /clauth not found/,
    `expected a "clauth not found" hint, got:\n${run.stdout}`,
  );
  assert.match(
    run.stdout,
    /clauth plugin register/,
    'the hint must carry the manual command so a human can finish registration',
  );
} finally {
  rmSync(emptyPathDir, { recursive: true, force: true });
}

// --------------------------------- 2. clauth present -> register invoked right

{
  const { spawn, calls } = stubSpawn([
    { status: 0, stdout: '0.33.0\n', stderr: '' }, // --version probe
    { status: 0, stdout: 'registered\n', stderr: '' }, // plugin register
  ]);
  const { log, lines } = collectLog();
  const result = postinstall.register({ spawn, log });

  assert.equal(result.outcome, 'registered');
  assert.equal(calls.length, 2, 'expected a --version probe followed by the register call');
  assert.equal(calls[0].command, 'clauth');
  assert.deepEqual(calls[0].args.map(unquote), ['--version']);

  assert.equal(calls[1].command, 'clauth');
  assert.deepEqual(
    calls[1].args.map(unquote),
    ['plugin', 'register', join(REPO_ROOT, 'clauth-plugin.json')],
    'register must be called as `clauth plugin register <package-root>/clauth-plugin.json`',
  );
  assert.ok(calls[1].options.timeout > 0, 'the register call must be time-bounded');
  assert.match(lines.join('\n'), /registered/);
}

// ------------------------- 3. non-zero register / throwing spawn -> exit 0 + hint

{
  const { spawn } = stubSpawn([
    { status: 0, stdout: '0.33.0\n', stderr: '' },
    { status: 1, stdout: '', stderr: 'manifest rejected: bad schema\n' },
  ]);
  const { log, lines } = collectLog();
  const result = postinstall.register({ spawn, log });

  assert.equal(result.outcome, 'register-failed', 'a non-zero register must not throw');
  assert.match(lines.join('\n'), /clauth plugin register failed/);
  assert.match(lines.join('\n'), /manifest rejected: bad schema/, 'the hint should surface why');
  assert.match(lines.join('\n'), /retry with: clauth plugin register/);
}

{
  // spawn itself blowing up (EPERM, locked binary, AV interference) is still exit 0.
  const { spawn } = stubSpawn([
    { status: 0, stdout: '0.33.0\n', stderr: '' },
    () => {
      throw new Error('EPERM: operation not permitted');
    },
  ]);
  const { log, lines } = collectLog();
  const result = postinstall.register({ spawn, log });

  assert.equal(result.outcome, 'spawn-failed');
  assert.match(lines.join('\n'), /EPERM/);
}

{
  // clauth on PATH but broken (`--version` non-zero) reads as "not available".
  const { spawn, calls } = stubSpawn([{ status: 9009, stdout: '', stderr: 'not recognized' }]);
  const { log, lines } = collectLog();
  const result = postinstall.register({ spawn, log });

  assert.equal(result.outcome, 'no-clauth');
  assert.equal(calls.length, 1, 'a failed probe must not go on to attempt registration');
  assert.match(lines.join('\n'), /clauth not found/);
}

{
  // A package root with no manifest is a hint, not a crash.
  const bare = mkdtempSync(join(tmpdir(), 'rdc-postinstall-bare-'));
  try {
    const { spawn, calls } = stubSpawn([]);
    const { log, lines } = collectLog();
    const result = postinstall.register({ packageRoot: bare, spawn, log });

    assert.equal(result.outcome, 'no-manifest');
    assert.equal(calls.length, 0, 'a missing manifest must not spawn anything');
    assert.match(lines.join('\n'), /not found/);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
}

// ----------------------------------- 4. the manifest path is package-anchored
//
// `npm i -g` runs the postinstall from an arbitrary cwd. Anything cwd-relative
// would resolve to a path that does not exist and register nothing at all.

{
  assert.equal(
    postinstall.manifestPath(),
    join(REPO_ROOT, 'clauth-plugin.json'),
    'the default manifest path must be the package root, not the cwd',
  );

  const foreignCwd = mkdtempSync(join(tmpdir(), 'rdc-postinstall-cwd-'));
  try {
    const run = spawnSync(process.execPath, [script], {
      cwd: foreignCwd, // deliberately NOT the package root
      encoding: 'utf8',
      env: envWithOnlyPath(foreignCwd),
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.ok(
      run.stdout.includes(join(REPO_ROOT, 'clauth-plugin.json')),
      `hint must name the package-root manifest, not a cwd-relative one:\n${run.stdout}`,
    );
    assert.ok(
      !run.stdout.includes(join(foreignCwd, 'clauth-plugin.json')),
      'the manifest path must never be resolved against the caller cwd',
    );
  } finally {
    rmSync(foreignCwd, { recursive: true, force: true });
  }
}

// --------------------------------- 5. the manifest actually ships in the tarball
//
// Self-registration is worthless if `clauth-plugin.json` is not in the package
// the user installed.

{
  const pack = spawnSync('npm', ['pack', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(pack.status, 0, `npm pack --dry-run failed:\n${pack.stdout}\n${pack.stderr}`);
  const packOutput = `${pack.stdout}\n${pack.stderr}`;
  assert.match(
    packOutput,
    /clauth-plugin\.json/,
    'clauth-plugin.json must be present in the published tarball',
  );
  assert.match(
    packOutput,
    /scripts\/postinstall\.js/,
    'scripts/postinstall.js must be present in the published tarball',
  );
}

/** Strip the Windows shell quoting the script applies to spawn args. */
function unquote(arg) {
  const s = String(arg);
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\"/g, '"') : s;
}

console.log('clauth plugin postinstall tests — PASS');
