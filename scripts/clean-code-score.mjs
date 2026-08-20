#!/usr/bin/env node
/**
 * clean-code-score — mechanical Clean Code rule catalog (N1/N2/N4/N7/F1/F2/
 * E1/G9), language-plugin-based, same architecture as solid-score.mjs: this
 * CLI owns argv parsing, file walking, and output formatting; it does NOT
 * know what an AST node is — every fact comes from `lib/plugins/typescript.mjs`
 * via the `lib/language-plugin.mjs` contract, and every rule is a pure
 * function in `lib/clean-code-scoring.mjs`.
 *
 * G9's unused-export half needs a cross-file reference scan
 * (`plugin.deadExportsOf`), which is genuinely project-wide — it cannot be
 * answered from one file in isolation. This CLI always builds the export-
 * usage project scope from the FULL walk (not just the requested target),
 * so a single-file target still gets real cross-file dead-export answers
 * (the `--project-root` flag only widens that scope further, e.g. to
 * include a sibling `tests/` directory outside the scanned tree).
 *
 * Before trusting any `referenceCount === 0` finding, this CLI runs the SAME
 * scan against a KNOWN-used export (`cleanCodeScore`, exported from
 * lib/clean-code-scoring.mjs and genuinely called a few lines below in this
 * very file) and refuses to report dead-export findings if that positive
 * control itself comes back at 0 — see `runPositiveControl()`. That is the
 * rule required by .claude/rules/prove-absence-positive-control.md and by
 * this task's own instruction: an unverified "zero callers" is a guess, not
 * a finding.
 *
 * Usage:
 *   node clean-code-score.mjs <path> [--project-root <dir>] [--format text|json] [--no-dead-exports]
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { registerPlugin, pluginFor } from './lib/language-plugin.mjs';
import { typescriptPlugin } from './lib/plugins/typescript.mjs';
import { cleanCodeScore } from './lib/clean-code-scoring.mjs';

registerPlugin(typescriptPlugin);

const EXCLUDE_DIRS = new Set(['node_modules', '.git']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Bash-tool / MSYS argv can hand this native-Windows process a POSIX-shaped
 * path (`/c/Dev/...`) — normalize before use. Mirrors solid-score.mjs's
 * normalizePath() exactly (same failure mode, same fix).
 */
function normalizePath(p) {
  const m = /^\/([A-Za-z])\/(.*)$/.exec(p);
  const windowsShaped = m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
  const abs = resolve(process.cwd(), windowsShaped);
  try { return realpathSync(abs); } catch { return abs; }
}

function arg(name, fallback = null) { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; }
function flag(name) { return process.argv.includes(name); }

/**
 * Prove the dead-export scan itself works before trusting any zero result
 * from it. `known` is {filePath, exportName} — a symbol the caller KNOWS is
 * referenced elsewhere in `projectFiles` (this CLI uses its own `main`,
 * which `isMain` below genuinely calls).
 */
function runPositiveControl(plugin, known, projectFiles) {
  if (typeof plugin.deadExportsOf !== 'function') {
    return { ok: false, reason: 'plugin has no deadExportsOf — G9 export-usage half unmeasured for this language' };
  }
  const facts = plugin.deadExportsOf(known.filePath, projectFiles);
  const hit = facts.find((f) => f.name === known.exportName);
  if (!hit) return { ok: false, reason: `positive control export '${known.exportName}' not found in scan results at all — scan is broken` };
  if (hit.referenceCount <= 0) return { ok: false, reason: `positive control export '${known.exportName}' scanned as referenceCount=${hit.referenceCount}, expected >0 — scan is broken, not the project` };
  return { ok: true, referenceCount: hit.referenceCount };
}

async function main() {
  const rawTarget = process.argv[2]?.startsWith('--') ? process.cwd() : (process.argv[2] ?? process.cwd());
  const targetPath = normalizePath(rawTarget);
  const format = arg('--format', 'text');
  const projectRootArg = arg('--project-root');
  const skipDeadExports = flag('--no-dead-exports');

  if (!existsSync(targetPath)) throw new Error(`target path does not exist: ${targetPath}`);
  const isFile = statSync(targetPath).isFile();
  const targetFiles = isFile ? [targetPath] : walk(targetPath);
  const scannedFiles = targetFiles.filter((f) => pluginFor(f));

  // Export-usage project scope: --project-root if given, else the WHOLE
  // containing repo (never just the scanned target/dir) — a real caller of
  // an export scanned under a directory target routinely lives OUTSIDE that
  // directory (confirmed live: scanning only `scripts/lib` reported
  // `loadAllManifests` as a dead export at referenceCount 0, because its two
  // real callers — scripts/acceptance.mjs, scripts/self-test.mjs — are
  // siblings of `lib/`, not inside it). Defaulting to the target dir instead
  // of the repo root is a false-positive generator, not a narrower-but-valid
  // scope.
  let projectFiles = scannedFiles;
  if (!skipDeadExports) {
    let scopeDir = projectRootArg ? normalizePath(projectRootArg) : (isFile ? dirname(targetPath) : targetPath);
    if (!projectRootArg) {
      try { scopeDir = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: scopeDir, encoding: 'utf8' }).trim(); } catch { /* not a repo — fall back to the target's own dir */ }
    }
    projectFiles = walk(scopeDir).filter((f) => pluginFor(f));
  }

  // Positive control target: `cleanCodeScore`, exported from
  // lib/clean-code-scoring.mjs and genuinely called a few lines below in
  // THIS file — a real, known-used symbol, not a synthetic one.
  const scoringLibPath = normalizePath(join(dirname(process.argv[1]), 'lib', 'clean-code-scoring.mjs'));
  const plugin = pluginFor(scoringLibPath);
  let deadExportsAvailable = false;
  let positiveControl = null;
  if (!skipDeadExports && plugin) {
    const controlScope = [...new Set([scoringLibPath, normalizePath(process.argv[1]), ...projectFiles])];
    positiveControl = runPositiveControl(plugin, { filePath: scoringLibPath, exportName: 'cleanCodeScore' }, controlScope);
    deadExportsAvailable = positiveControl.ok;
  }

  const results = [];
  const unresolvedLanguages = [];

  for (const f of scannedFiles) {
    const p = pluginFor(f);
    if (!p) { unresolvedLanguages.push(f); continue; }
    const units = p.extractUnits(f);
    const deadExportsFacts = deadExportsAvailable ? p.deadExportsOf(f, projectFiles) : null;
    results.push({ file: f, units: units.map((u) => cleanCodeScore(u, deadExportsFacts)) });
  }

  const output = {
    results, unresolvedLanguages,
    deadExportsScope: skipDeadExports ? null : { fileCount: projectFiles.length, positiveControlOk: deadExportsAvailable, positiveControl },
    notImplemented: ['N3', 'N5', 'N6', 'C1', 'C2', 'C3', 'C4', 'C5', 'G5', 'G14', 'G16', 'G28'],
  };

  if (format === 'json') {
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const r of results) {
      for (const u of r.units) {
        if (u.totalFindings === 0) continue;
        console.log(`${relative(process.cwd(), r.file).split(sep).join('/')} :: ${u.unit} (${u.kind}) — ${u.totalFindings} finding(s)`);
        for (const rule of Object.values(u.rules)) {
          for (const f of rule.findings) console.log(`  [${rule.ruleId}] [${rule.confidence}] ${f.location} — ${f.detail}`);
        }
      }
    }
    if (!skipDeadExports) {
      console.log(deadExportsAvailable
        ? `\nDead-export scan: positive control OK (${positiveControl.referenceCount} reference(s) found for a known-used symbol) — ${projectFiles.length} file(s) in scope.`
        : `\nDead-export scan: SKIPPED — positive control failed (${positiveControl?.reason ?? 'unknown'}). G9 export-usage findings are NOT reported; only the unreachable-code half ran.`);
    }
    if (unresolvedLanguages.length) {
      console.log(`\n${unresolvedLanguages.length} file(s) matched no registered language plugin — skipped, not silently passed.`);
    }
    console.log(`\nNot implemented (heuristic quality too low / needs a semantic model): ${output.notImplemented.join(', ')}`);
  }

  process.exit(0);
}

function realFileURL(p) {
  try { return pathToFileURL(realpathSync(p)).href; } catch { return pathToFileURL(p).href; }
}
const isMain = process.argv[1] && import.meta.url === realFileURL(process.argv[1]);
if (isMain) main().catch((err) => { console.error(err); process.exit(2); });
