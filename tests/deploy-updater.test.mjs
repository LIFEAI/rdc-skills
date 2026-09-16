// deploy/update-from-tag.sh — the public MCP follows release tags by itself.
//
// Behavioral: a real origin, a real deploy clone, and stub systemctl/npm/curl
// that model the running MCP the way it actually behaves — `git_sha` is fixed
// when the process starts, `version` is re-read from package.json on every
// request. So a restart that did not take, a release that never comes up, and a
// checkout moved without a restart are each observable exactly as on the host,
// and every outcome is proved by the commit the checkout ends on and what
// /health reports, not by a log line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPDATER = path.join(REPO_ROOT, 'deploy', 'update-from-tag.sh');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

function bashExecutable() {
  if (process.platform !== 'win32') return 'bash';
  // `bash` on a Windows PATH can be WSL's System32 shim, which cannot see these paths.
  const git = 'C:/Program Files/Git/bin/bash.exe';
  return fs.existsSync(git) ? git : 'bash';
}
const BASH = bashExecutable();
const slash = (p) => p.replace(/\\/g, '/');
// Git for Windows' bash.exe prepends /mingw64/bin and /usr/bin, so the stubs go
// on PATH from inside the shell, in its own path form.
const posix = (p) => (process.platform === 'win32' ? slash(p).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p);

function sandbox() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-skills-updater-')));
  const gitConfig = path.join(dir, 'gitconfig');
  fs.writeFileSync(gitConfig, '[user]\n\tname = updater-test\n\temail = updater-test@example.invalid\n[init]\n\tdefaultBranch = master\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const run = (cwd, args) => {
    const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };

  const origin = path.join(dir, 'origin.git');
  const author = path.join(dir, 'author');
  const deploy = path.join(dir, 'deploy');
  const units = path.join(dir, 'units');
  const libexec = path.join(dir, 'libexec');
  const stateDir = path.join(dir, 'state');
  const stubs = path.join(dir, 'stubs');
  const svc = path.join(dir, 'svc');
  for (const d of [author, units, stubs, svc]) fs.mkdirSync(d, { recursive: true });
  run(dir, ['init', '--bare', '-q', origin]);
  run(author, ['init', '-q']);
  run(author, ['remote', 'add', 'origin', slash(origin)]);

  const write = (relative, body) => {
    const file = path.join(author, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  // release(version, { tag }) — tag: true → `v<version>`, a string → that name, false → untagged.
  const release = (version, { lock = `lock-${version}`, unit = 'unit-v1', broken = false, tag = true, branch = 'master' } = {}) => {
    write('.gitignore', 'node_modules/\ngit-sha.json\n');
    write('package.json', JSON.stringify({ name: 'rdc-skills-fixture', version }, null, 2) + '\n');
    write('package-lock.json', JSON.stringify({ marker: lock }) + '\n');
    write('deploy/systemd/rdc-skills-mcp.service', `# ${unit}\n`);
    write('deploy/update-from-tag.sh', `# updater as of ${version}\n`);
    if (broken) write('BROKEN', 'this release never answers /health\n');
    else fs.rmSync(path.join(author, 'BROKEN'), { force: true });
    run(author, ['add', '-A']);
    run(author, ['commit', '-q', '--allow-empty', '-m', `release ${version}`]);
    const name = tag === true ? `v${version}` : tag;
    if (name) run(author, ['tag', name]);
    run(author, ['push', '-q', 'origin', `HEAD:${branch}`, ...(name ? [`refs/tags/${name}`] : [])]);
    return run(author, ['rev-parse', 'HEAD']);
  };

  const stub = (name, body) => {
    const file = path.join(stubs, name);
    fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };
  const calls = path.join(dir, 'calls.log');
  const started = path.join(svc, 'started-sha');
  // restart: the process starts on whatever commit the checkout holds — unless
  // this release is BROKEN (it never answers), or the restart silently does not
  // take (svc/no-restart), in which case the old process keeps running.
  stub('systemctl', [
    `echo "systemctl $*" >> "${slash(calls)}"`,
    'if [[ "$1" == restart ]]; then',
    // svc/restart-fail-once: the restart stops the old process and fails to start.
    `  if [[ -f "${slash(svc)}/restart-fail-once" ]]; then rm -f "${slash(svc)}/restart-fail-once" "${slash(started)}"; exit 1; fi`,
    `  [[ -f "${slash(svc)}/no-restart" ]] && exit 0`,
    `  if [[ -f "${slash(deploy)}/BROKEN" ]]; then rm -f "${slash(started)}"; exit 0; fi`,
    `  git -C "${slash(deploy)}" rev-parse HEAD > "${slash(started)}"`,
    'fi',
  ].join('\n'));
  // npm: svc/npm-fail fails every install (a registry outage); svc/npm-fail-once fails one.
  stub('npm', [
    `echo "npm $*" >> "${slash(calls)}"`,
    `if [[ -f "${slash(svc)}/npm-fail" ]]; then echo "npm error code ETIMEDOUT" >&2; echo "npm error network request to https://registry.npmjs.org failed" >&2; exit 1; fi`,
    // A release whose own lockfile can never install.
    'if grep -q uninstallable package-lock.json; then echo "npm error code ETARGET" >&2; echo "npm error notarget No matching version found for $(cat package-lock.json)" >&2; exit 1; fi',
    `if [[ -f "${slash(svc)}/npm-fail-once" ]]; then rm -f "${slash(svc)}/npm-fail-once"; echo "npm error code EINTEGRITY" >&2; exit 1; fi`,
    'rm -rf node_modules; mkdir -p node_modules',
  ].join('\n'));
  // /health: git_sha fixed at process start; version read from disk per request.
  // svc/curl-fail-once: one request times out (a slow answer).
  stub('curl', [
    `if [[ -f "${slash(svc)}/curl-fail-once" ]]; then rm -f "${slash(svc)}/curl-fail-once"; exit 28; fi`,
    `[[ -f "${slash(started)}" ]] || exit 7`,
    `ver="$(node -p "require('fs').readFileSync('${slash(deploy)}/package.json','utf8').match(/\\"version\\": \\"([^\\"]+)/)[1]")"`,
    `printf '{"status":"ok","version":"%s","git_sha":"%s"}' "$ver" "$(tr -d '\\r\\n' < "${slash(started)}")"`,
  ].join('\n'));

  const updaterEnv = (overrides = {}) => ({
    ...env,
    RDC_TEST_STUBS: posix(stubs),
    RDC_TEST_UPDATER: slash(UPDATER),
    RDC_SKILLS_DEPLOY_ROOT: slash(deploy),
    RDC_SKILLS_EXPECTED_ROOT: slash(deploy),
    RDC_SKILLS_UNIT_DIR: slash(units),
    RDC_SKILLS_LIBEXEC_DIR: slash(libexec),
    RDC_SKILLS_STATE_DIR: slash(stateDir),
    RDC_SKILLS_LOCK_FILE: slash(path.join(dir, 'update.lock')),
    RDC_SKILLS_HEALTH_URL: 'http://127.0.0.1:1/health',
    RDC_SKILLS_HEALTH_DEADLINE: '0',
    RDC_SKILLS_HEALTH_INTERVAL: '0',
    ...overrides,
  });
  const update = (overrides) => {
    const r = spawnSync(BASH, ['-c', 'PATH="$RDC_TEST_STUBS:$PATH" exec bash "$RDC_TEST_UPDATER"'], { env: updaterEnv(overrides), encoding: 'utf8', input: '' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const clearCalls = () => fs.rmSync(calls, { force: true });
  const cloneOnly = () => run(dir, ['clone', '-q', '--branch', 'master', slash(origin), slash(deploy)]);
  // The service as an operator left it: started by hand on whatever is checked out.
  const startService = () => {
    const r = spawnSync(BASH, ['-c', `"${posix(path.join(stubs, 'systemctl'))}" restart rdc-skills-mcp.service`], { env: updaterEnv(), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    clearCalls();
  };
  // A host brought up by the bootstrap: cloned, then converged and proved once.
  const bootstrap = () => {
    cloneOnly();
    const r = update();
    assert.equal(r.status, 0, `bootstrap did not converge: ${r.out}`);
    clearCalls();
    return r;
  };
  const head = () => run(deploy, ['rev-parse', 'HEAD']);
  const servingSha = () => (fs.existsSync(started) ? fs.readFileSync(started, 'utf8').trim() : null);
  const callLog = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '');
  const restarts = () => (callLog().match(/systemctl restart/g) || []).length;
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const failedList = () => {
    const f = path.join(stateDir, 'failed');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  };
  return { release, bootstrap, cloneOnly, startService, update, head, servingSha, callLog, restarts, clearCalls, failedList, run, deploy, author, origin, units, libexec, svc, started, cleanup };
}

test('a fresh checkout converges on first run: installs, restarts, and proves the tag', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const v1 = s.release('1.0.0');
  s.run(path.dirname(s.deploy), ['clone', '-q', '--branch', 'master', slash(s.origin), slash(s.deploy)]);
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.equal(s.servingSha(), v1, 'the service was restarted onto the tag');
  assert.match(s.callLog(), /npm ci --omit=dev --no-audit --no-fund --ignore-scripts/);
  assert.equal(fs.readFileSync(path.join(s.libexec, 'update-from-tag.sh'), 'utf8'), '# updater as of 1.0.0\n',
    'the proved release refreshed the updater copy outside the checkout');
});

test('a proved host at the newest tag is left alone', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('1.0.0');
  s.bootstrap();
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /current at v1\.0\.0/);
  assert.equal(s.callLog(), '', 'nothing installed, nothing restarted');
});

test('a new tag is fast-forwarded, reinstalled when the lock moved, restarted, and proved', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('1.9.0');
  s.bootstrap();
  // v1.10.0 sorts BEFORE v1.9.0 lexically; the updater must pick it by version.
  const v110 = s.release('1.10.0');
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.equal(s.head(), v110);
  assert.equal(s.servingSha(), v110);
  assert.match(s.callLog(), /npm ci/);
  assert.equal(fs.readFileSync(path.join(s.libexec, 'update-from-tag.sh'), 'utf8'), '# updater as of 1.10.0\n');
});

test('a lock file that did not change is not reinstalled', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('2.0.0', { lock: 'same' });
  s.bootstrap();
  const v201 = s.release('2.0.1', { lock: 'same' });
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.equal(s.servingSha(), v201);
  assert.doesNotMatch(s.callLog(), /npm ci/);
});

test('an untagged commit on master is not deployed — the tag is the promotion', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const v1 = s.release('1.0.0');
  s.bootstrap();
  s.release('1.0.1', { tag: false });
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.equal(s.head(), v1);
});

test('a newer release tag that is not on master is not deployed', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const v1 = s.release('1.0.0');
  s.bootstrap();
  s.release('9.0.0', { branch: 'side' });
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.equal(s.head(), v1);
  assert.equal(s.servingSha(), v1);
});

test('pre-release and stray v* tags are never served and never outrank a release', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const v3 = s.release('3.0.0');
  s.bootstrap();
  s.release('3.1.0-rc.1', { tag: 'v3.1.0-rc.1' });
  s.release('3.1.0-wip', { tag: 'v99-test' });
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /current at v3\.0\.0/, 'v99-test and v3.1.0-rc.1 both sort above v3.0.0 and are ignored');
  assert.equal(s.servingSha(), v3, 'still serving the last plain release');
});

test('a release that never answers is rolled back, then skipped until a newer tag', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const good = s.release('3.0.0');
  s.bootstrap();
  s.release('3.1.0', { broken: true });

  const first = s.update();
  assert.equal(first.status, 5, first.out);
  assert.equal(s.head(), good, 'checkout ends on the release that answered');
  assert.equal(s.servingSha(), good, '/health proves the rollback took');

  s.clearCalls();
  const again = s.update();
  assert.equal(again.status, 7, again.out);
  assert.equal(s.restarts(), 0, 'a failed release is not retried every tick');
  assert.equal(s.head(), good);

  const fixed = s.release('3.2.0');
  const next = s.update();
  assert.equal(next.status, 0, next.out);
  assert.equal(s.servingSha(), fixed);
});

test('an install outage is not a bad release: nothing is recorded, and the release ships once the outage ends', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const good = s.release('2.0.0');
  s.bootstrap();
  const next = s.release('2.1.0');
  fs.writeFileSync(path.join(s.svc, 'npm-fail'), '');
  // Longer than the install-error limit: a registry outage is never counted.
  for (let i = 0; i < 4; i += 1) {
    const during = s.update();
    assert.equal(during.status, 6, during.out);
  }
  assert.equal(s.head(), good, 'the checkout is back on the release that was serving');
  assert.equal(s.servingSha(), good);
  assert.deepEqual(s.failedList(), [], 'an outage says nothing about the release');

  fs.rmSync(path.join(s.svc, 'npm-fail'));
  const after = s.update();
  assert.equal(after.status, 0, after.out);
  assert.equal(s.servingSha(), next);
});

test('a release that never reaches the registry is judged bad once the network-error window passes', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const good = s.release('2.0.0');
  s.bootstrap();
  const next = s.release('2.1.0', { lock: 'network-only' });
  fs.writeFileSync(path.join(s.svc, 'npm-fail'), '');
  const r = s.update({ RDC_SKILLS_NETWORK_ERROR_WINDOW: '0' });
  assert.equal(r.status, 6, r.out); // bad, but its own return to 2.0.0 hits the same outage
  assert.deepEqual(s.failedList(), [next]);
  assert.equal(s.servingSha(), good);
});

test('only npm\'s own error lines count as a network failure', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('2.0.0');
  s.bootstrap();
  // A lockfile problem whose message merely mentions a network-ish package name.
  const next = s.release('2.1.0', { lock: 'uninstallable network-utils' });
  const statuses = [s.update(), s.update(), s.update()].map((r) => r.status);
  assert.deepEqual(statuses, [6, 6, 5], 'counted like any install error');
  assert.deepEqual(s.failedList(), [next]);
});

test('a one-off install failure is retried on the next run, not skipped until a newer tag', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const good = s.release('2.0.0');
  s.bootstrap();
  const next = s.release('2.1.0');
  fs.writeFileSync(path.join(s.svc, 'npm-fail-once'), '');
  const first = s.update();
  assert.equal(first.status, 6, first.out);
  assert.equal(s.servingSha(), good, 'the rollback reinstalled and restarted the previous release');
  const second = s.update();
  assert.equal(second.status, 0, second.out);
  assert.equal(s.servingSha(), next);
  assert.deepEqual(s.failedList(), []);
});

test('bootstrap with no history: a bad release returns to the commit that was serving', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const serving = s.release('1.0.0');
  s.cloneOnly();
  s.startService();
  const bad = s.release('1.1.0', { broken: true });
  // The operator's bootstrap step: fast-forward the checkout to the new tag.
  s.run(s.deploy, ['fetch', '-q', '--tags', 'origin']);
  s.run(s.deploy, ['merge', '-q', '--ff-only', 'v1.1.0']);

  const first = s.update();
  assert.equal(first.status, 5, first.out);
  assert.equal(s.head(), serving);
  assert.equal(s.servingSha(), serving, '/health proves the host is back on what it served before');

  s.clearCalls();
  for (let i = 0; i < 2; i += 1) {
    const again = s.update();
    assert.equal(again.status, 7, again.out);
  }
  assert.equal(s.restarts(), 0, 'a held, healthy release is not restarted');
  assert.deepEqual(s.failedList(), [bad], 'recorded once, however many runs');
});

test('a bad release with nothing to return to fails every run, and is recorded once', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('1.0.0', { broken: true });
  s.cloneOnly(); // never served anything: no history, and /health does not answer
  const bad = s.head();
  for (let i = 0; i < 3; i += 1) {
    const r = s.update();
    assert.equal(r.status, 6, r.out);
  }
  assert.deepEqual(s.failedList(), [bad]);
});

test('a skipped release still holds what is checked out: a service that died is brought back', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const good = s.release('3.0.0');
  s.bootstrap();
  s.release('3.1.0', { broken: true });
  assert.equal(s.update().status, 5);
  fs.rmSync(s.started); // the process crashed after the rollback
  const r = s.update();
  assert.equal(r.status, 7, r.out);
  assert.equal(s.servingSha(), good);
  assert.equal(s.restarts() > 0, true);
});

test('the proved release is never marked failed, even when it does not come back up', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('1.0.0');
  s.bootstrap();
  fs.rmSync(s.started); // it crashed
  fs.writeFileSync(path.join(s.svc, 'no-restart'), ''); // and the restart does not take
  const r = s.update();
  assert.equal(r.status, 6, r.out);
  assert.deepEqual(s.failedList(), [], 'it served before; a slow or broken host is not a bad release');
});

test('one slow /health answer does not restart a healthy service', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('1.0.0');
  s.bootstrap();
  fs.writeFileSync(path.join(s.svc, 'curl-fail-once'), '');
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /current at v1\.0\.0/);
  assert.equal(s.restarts(), 0);
});

test('a restart that silently does not take is not reported as a deploy', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const v1 = s.release('4.0.0');
  s.bootstrap();
  s.release('4.1.0');
  fs.writeFileSync(path.join(s.svc, 'no-restart'), '');
  const r = s.update();
  assert.notEqual(r.status, 0, r.out);
  assert.equal(s.servingSha(), v1, 'the old process is still the one serving');
  assert.equal(s.head(), v1, 'the checkout is back on what is actually running');
});

test('a checkout moved without a restart (an interrupted run) converges instead of reading as current', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const v1 = s.release('5.0.0');
  s.bootstrap();
  const v2 = s.release('5.1.0');
  s.run(s.deploy, ['fetch', '-q', 'origin']);
  s.run(s.deploy, ['reset', '-q', '--hard', v2]);
  assert.equal(s.servingSha(), v1, 'precondition: the service never restarted');
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /converging/);
  assert.match(s.callLog(), /npm ci/, 'the lock moved with the interrupted checkout, so it is reinstalled');
  assert.equal(s.servingSha(), v2);
});

test('a tag moved on origin does not block later releases', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('6.0.0');
  s.bootstrap();
  // Re-created on an unrelated commit: not a fast-forward of where it was, so
  // only a forced fetch can follow it.
  const unrelated = s.run(s.author, ['commit-tree', 'HEAD^{tree}', '-m', 'v6.0.0 re-created elsewhere']);
  s.run(s.author, ['tag', '-f', 'v6.0.0', unrelated]);
  s.run(s.author, ['push', '-q', '-f', 'origin', 'refs/tags/v6.0.0']);
  const v61 = s.release('6.1.0');
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.equal(s.servingSha(), v61);
});

test('tracked changes on the host are preserved and nothing moves', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const v1 = s.release('7.0.0');
  s.bootstrap();
  s.release('7.1.0');
  fs.appendFileSync(path.join(s.deploy, 'package.json'), '\n');
  const r = s.update();
  assert.equal(r.status, 3, r.out);
  assert.equal(s.head(), v1);
  assert.match(fs.readFileSync(path.join(s.deploy, 'package.json'), 'utf8'), /\n\n$/, 'the local edit survives');
  assert.equal(s.callLog(), '');
});

test('a host commit that the tag does not descend from is refused, not overwritten', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('8.0.0');
  s.bootstrap();
  s.release('8.1.0');
  s.run(s.deploy, ['commit', '-q', '--allow-empty', '-m', 'hotfix made on the host']);
  const local = s.head();
  const r = s.update();
  assert.equal(r.status, 4, r.out);
  assert.equal(s.head(), local, 'the host commit is preserved');
  assert.notEqual(s.servingSha(), local, 'and never served');
  assert.equal(s.restarts(), 0, 'the service is left as it is');
});

test('a higher tag on an older commit is not a release: the proved one is held, and a real newer tag ships', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const old = s.release('1.0.0');
  const current = s.release('2.0.0');
  s.bootstrap();
  s.run(s.author, ['tag', 'v2.0.1', old]);
  s.run(s.author, ['push', '-q', 'origin', 'refs/tags/v2.0.1']);
  const r = s.update();
  assert.equal(r.status, 9, r.out);
  assert.equal(s.servingSha(), current, 'never downgraded');
  assert.equal(s.restarts(), 0);
  const next = s.release('3.0.0');
  const after = s.update();
  assert.equal(after.status, 0, after.out);
  assert.equal(s.servingSha(), next);
});

test('with no history, a service running a host-made commit is not adopted, and the commit is kept', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('1.0.0');
  s.cloneOnly();
  s.run(s.deploy, ['commit', '-q', '--allow-empty', '-m', 'made on the host']);
  const local = s.head();
  s.startService();
  s.release('1.1.0');
  const r = s.update();
  assert.equal(r.status, 4, r.out);
  assert.doesNotMatch(r.out, /adopted/);
  assert.equal(s.head(), local);
  assert.equal(s.servingSha(), local, 'the service is left as it is');
});

test('a failed refresh of the updater copy is reported, and retried until it lands', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('1.0.0');
  s.bootstrap();
  s.release('1.1.0');
  const blocked = path.join(s.svc, 'not-a-directory');
  fs.writeFileSync(blocked, '');
  const first = s.update({ RDC_SKILLS_LIBEXEC_DIR: slash(path.join(blocked, 'libexec')) });
  assert.equal(first.status, 8, first.out);
  const second = s.update();
  assert.equal(second.status, 0, second.out);
  assert.equal(fs.readFileSync(path.join(s.libexec, 'update-from-tag.sh'), 'utf8'), '# updater as of 1.1.0\n');
});

test('a pull to untagged master is moved back to the release, not served', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const v1 = s.release('1.0.0', { lock: 'same' });
  s.bootstrap();
  const untagged = s.release('1.0.1', { lock: 'same', tag: false });
  // The old manual procedure: git pull --ff-only origin master.
  s.run(s.deploy, ['fetch', '-q', 'origin']);
  s.run(s.deploy, ['merge', '-q', '--ff-only', untagged]);
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.equal(s.head(), v1);
  assert.equal(s.servingSha(), v1);
  assert.equal(s.restarts(), 0, 'it was still serving the release; only the checkout moved back');
});

test('a release whose lockfile never installs is retried twice, then treated as bad', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const good = s.release('2.0.0');
  s.bootstrap();
  const broken = s.release('2.1.0', { lock: 'uninstallable' });
  const statuses = [s.update(), s.update(), s.update()].map((r) => r.status);
  assert.deepEqual(statuses, [6, 6, 5]);
  assert.equal(s.servingSha(), good);
  assert.deepEqual(s.failedList(), [broken]);
  s.clearCalls();
  const held = s.update();
  assert.equal(held.status, 7, held.out);
  assert.equal(s.restarts(), 0);
  assert.doesNotMatch(s.callLog(), /npm ci/);
});

test('bootstrap: a restart that fails on the new release returns to the adopted serving commit', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const serving = s.release('1.0.0');
  s.cloneOnly();
  s.startService();
  const next = s.release('1.1.0');
  s.run(s.deploy, ['fetch', '-q', '--tags', 'origin']);
  s.run(s.deploy, ['merge', '-q', '--ff-only', 'v1.1.0']);
  fs.writeFileSync(path.join(s.svc, 'restart-fail-once'), '');
  const first = s.update();
  assert.equal(first.status, 6, first.out);
  assert.equal(s.servingSha(), serving, 'the way back survived the failed restart');
  const second = s.update();
  assert.equal(second.status, 0, second.out);
  assert.equal(s.servingSha(), next);
});

test('changed unit files are installed and systemd reloaded', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('9.0.0', { unit: 'unit-v1' });
  s.bootstrap();
  s.release('9.1.0', { unit: 'unit-v2' });
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.match(fs.readFileSync(path.join(s.units, 'rdc-skills-mcp.service'), 'utf8'), /unit-v2/);
  assert.match(s.callLog(), /systemctl daemon-reload/);
});

test('a stale git-sha.json stamp in the checkout is removed so the proof can pass', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('10.0.0');
  s.bootstrap();
  const v2 = s.release('10.1.0');
  fs.writeFileSync(path.join(s.deploy, 'git-sha.json'), '{"sha":"0000000"}\n');
  const r = s.update();
  assert.equal(r.status, 0, r.out);
  assert.equal(fs.existsSync(path.join(s.deploy, 'git-sha.json')), false);
  assert.equal(s.servingSha(), v2);
});

test('the updater refuses any checkout other than the host path', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.release('11.0.0');
  s.bootstrap();
  const r = s.update({ RDC_SKILLS_EXPECTED_ROOT: '/srv/regen/rdc-skills' });
  assert.equal(r.status, 2, r.out);
});

test('the units and installer run the updater from outside the checkout', () => {
  const timer = read('deploy/systemd/rdc-skills-mcp-update.timer');
  const service = read('deploy/systemd/rdc-skills-mcp-update.service');
  const installer = read('deploy/install-systemd.sh');
  const updater = read('deploy/update-from-tag.sh');
  assert.match(timer, /OnUnitActiveSec=/);
  assert.doesNotMatch(timer, /Persistent=/, 'Persistent= only applies to OnCalendar=');
  assert.match(service, /Type=oneshot/);
  assert.match(service, /^ExecStart=\/usr\/local\/libexec\/rdc-skills\/update-from-tag\.sh$/m);
  assert.match(service, /^StateDirectory=rdc-skills-update$/m);
  assert.match(installer, /install -D -m 0755 deploy\/update-from-tag\.sh "\$libexec_dir\/update-from-tag\.sh"/);
  assert.match(installer, /systemctl start rdc-skills-mcp-update\.service/, 'the bootstrap restarts into the release and proves it');
  assert.match(installer, /systemctl enable --now rdc-skills-mcp-update\.timer/);
  assert.match(installer, /--ignore-scripts/);
  // The script replaces itself mid-run; only a body behind a final call is safe.
  assert.match(updater.trimEnd(), /\nmain "\$@"; exit \$\?$/);
});
