#!/usr/bin/env node
/**
 * refactoring-score — mechanical refactoring-opportunity catalog
 * (extract-method / extract-class / introduce-parameter-object /
 * replace-magic-number / consolidate-duplicate-code / decompose-conditional /
 * strategy-transform / factory-transform / null-object-transform),
 * language-plugin-based, same architecture as clean-code-score.mjs and
 * solid-score.mjs: this CLI owns argv parsing, file walking, and output
 * formatting; it does NOT know what an AST node is — every fact comes from
 * `lib/plugins/typescript.mjs` via the `lib/language-plugin.mjs` contract,
 * and every rule is a pure function in `lib/refactoring-scoring.mjs`.
 *
 * Detection thresholds are ported/corroborated from architecture-toolkit's
 * REAL implementation (MIT, github.com/OnSightTeam/architecture-toolkit) —
 * see refactoring-scoring.mjs's file header for the full citation and for
 * why two thresholds here deliberately differ from this repo's own
 * clean-code-scoring.mjs (extract-method >25 vs. F1's >20; introduce-
 * parameter-object >4 vs. F2's >3).
 *
 * Effort estimation (low/medium/high) needs a real cross-file call-site
 * count, which is genuinely project-wide — it cannot be answered from one
 * file in isolation. This CLI always builds the reference-scan project
 * scope from the FULL walk (not just the requested target), same pattern as
 * clean-code-score.mjs's dead-export scope, and runs the SAME kind of
 * positive control before trusting any effort estimate: a KNOWN-used
 * exported symbol (`refactoringScore` from this package's own
 * lib/refactoring-scoring.mjs, genuinely imported and called by this very
 * file) must scan back with a non-zero reference count, or effort
 * estimation is skipped entirely and every finding reports
 * `effort: null, confidence: 'unmeasured'` rather than guessing.
 *
 * Usage:
 *   node refactoring-score.mjs <path> [--project-root <dir>] [--format text|json] [--no-effort]
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { registerPlugin, pluginFor } from './lib/language-plugin.mjs';
import { typescriptPlugin } from './lib/plugins/typescript.mjs';
import { refactoringScore, estimateEffort } from './lib/refactoring-scoring.mjs';

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
 * path (`/c/Dev/...`) — normalize before use. Mirrors clean-code-score.mjs's
 * / solid-score.mjs's normalizePath() exactly (same failure mode, same fix).
 */
function normalizePath(p) {
  const m = /^\/([A-Za-z])\/(.*)$/.exec(p);
  const windowsShaped = m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
  const abs = resolve(process.cwd(), windowsShaped);
  try { return realpathSync(abs); } catch { return abs; }
}

function arg(name, fallback = null) { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; }
function flag(name) { return process.argv.includes(name); }

function printHelp() {
  console.log(`refactoring-score — mechanical refactoring-opportunity catalog

Usage:
  node refactoring-score.mjs <path> [--project-root <dir>] [--format text|json] [--no-effort]

Options:
  --project-root <dir>  Directory that bounds the cross-file call-site scan
                         used for effort estimation (default: the containing
                         git repo, or the target's own dir if not a repo).
  --format text|json    Output format (default: text).
  --no-effort           Skip the cross-file call-site scan entirely — every
                         finding reports effort: null, confidence: 'unmeasured'.
  --help                Show this message.

Refactoring types detected: extract-method, extract-class,
introduce-parameter-object, replace-magic-number, consolidate-duplicate-code,
decompose-conditional, strategy-transform, factory-transform,
null-object-transform. Detection logic: scripts/lib/refactoring-scoring.mjs.
`);
}

/**
 * Derive the target's own top-level package/app segment (e.g.
 * "packages/core", "apps/prt") from an absolute file path, for the
 * package-boundary-crossing effort criterion. Returns null when the file
 * isn't under a recognized `packages/*` or `apps/*` root — effort
 * estimation then falls back to call-site count alone.
 */
function packageOf(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const m = /\/(packages|apps|sites|models)\/([^/]+)\//.exec(norm);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Prove the reference-site scan itself works before trusting any effort
 * estimate from it. `known` is {filePath, exportName} — a symbol the caller
 * KNOWS is referenced elsewhere in `projectFiles` (this CLI uses its own
 * `refactoringScore`, which `isMain` below genuinely imports and calls).
 */
function runPositiveControl(plugin, known, projectFiles) {
  if (typeof plugin.referenceSitesOf !== 'function') {
    return { ok: false, reason: 'plugin has no referenceSitesOf — effort estimation unmeasured for this language' };
  }
  const result = plugin.referenceSitesOf(known.filePath, known.exportName, projectFiles);
  if (result.referenceCount <= 0) return { ok: false, reason: `positive control export '${known.exportName}' scanned as referenceCount=${result.referenceCount}, expected >0 — scan is broken, not the project` };
  return { ok: true, referenceCount: result.referenceCount };
}

async function main() {
  if (flag('--help') || flag('-h')) { printHelp(); process.exit(0); }

  const rawTarget = process.argv[2]?.startsWith('--') ? process.cwd() : (process.argv[2] ?? process.cwd());
  const targetPath = normalizePath(rawTarget);
  const format = arg('--format', 'text');
  const projectRootArg = arg('--project-root');
  const skipEffort = flag('--no-effort');

  if (!existsSync(targetPath)) throw new Error(`target path does not exist: ${targetPath}`);
  const isFile = statSync(targetPath).isFile();
  const targetFiles = isFile ? [targetPath] : walk(targetPath);
  const scannedFiles = targetFiles.filter((f) => pluginFor(f));

  // Effort-scan project scope: --project-root if given, else the WHOLE
  // containing repo (never just the scanned target/dir) — same rationale as
  // clean-code-score.mjs's dead-export scope: a real caller of a class/
  // function scanned under a directory target routinely lives OUTSIDE that
  // directory.
  let projectFiles = scannedFiles;
  if (!skipEffort) {
    let scopeDir = projectRootArg ? normalizePath(projectRootArg) : (isFile ? dirname(targetPath) : targetPath);
    if (!projectRootArg) {
      try { scopeDir = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: scopeDir, encoding: 'utf8' }).trim(); } catch { /* not a repo — fall back to the target's own dir */ }
    }
    projectFiles = walk(scopeDir).filter((f) => pluginFor(f));
  }

  // Positive control target: `refactoringScore`, exported from
  // lib/refactoring-scoring.mjs and genuinely called a few lines below in
  // THIS file — a real, known-used symbol, not a synthetic one.
  const scoringLibPath = normalizePath(join(dirname(process.argv[1]), 'lib', 'refactoring-scoring.mjs'));
  const plugin = pluginFor(scoringLibPath);
  let effortAvailable = false;
  let positiveControl = null;
  if (!skipEffort && plugin) {
    const controlScope = [...new Set([scoringLibPath, normalizePath(process.argv[1]), ...projectFiles])];
    positiveControl = runPositiveControl(plugin, { filePath: scoringLibPath, exportName: 'refactoringScore' }, controlScope);
    effortAvailable = positiveControl.ok;
  }

  const results = [];
  const unresolvedLanguages = [];

  for (const f of scannedFiles) {
    const p = pluginFor(f);
    if (!p) { unresolvedLanguages.push(f); continue; }
    const units = p.extractUnits(f);
    const unitPackage = packageOf(f);
    const unitScores = units.map((u) => {
      const score = refactoringScore(u);
      // Effort estimation only applies to CLASS units: `referenceSitesOf`
      // resolves ONE named export per call, and a class's own name IS the
      // export name it would be imported by. A 'module' unit's `u.name` is
      // the file's base name (e.g. "acceptance.mjs"), not an exported
      // symbol — there is no single call-site count for "this file" the
      // same way. Per-member (per-method/per-function) call-site counts are
      // NOT computed here either — see refactoring-score.mjs's own header
      // and the task report for why that's a documented scoping choice, not
      // an oversight.
      let effort = null;
      if (effortAvailable && u.kind === 'class' && p.referenceSitesOf) {
        const referenceSites = p.referenceSitesOf(f, u.name, projectFiles);
        if (referenceSites.referenceCount >= 0) {
          const estimate = estimateEffort({ unitPackage, referenceSites });
          effort = {
            ...estimate,
            files: referenceSites.files.map((rf) => relative(process.cwd(), rf).split(sep).join('/')).sort(),
          };
        }
      }
      return { ...score, effort };
    });
    // Stable finding order — sort each rule's findings by location so
    // re-running on unchanged input is byte-identical regardless of any
    // incidental AST-walk-order variance (ATF golden-capture requirement).
    for (const u of unitScores) {
      for (const rule of Object.values(u.rules)) {
        rule.findings.sort((a, b) => a.location.localeCompare(b.location));
      }
    }
    if (unitScores.some((u) => u.totalFindings > 0)) {
      results.push({ file: relative(process.cwd(), f).split(sep).join('/'), unitPackage, units: unitScores });
    }
  }
  results.sort((a, b) => a.file.localeCompare(b.file));

  const output = {
    results,
    unresolvedLanguages: unresolvedLanguages.map((f) => relative(process.cwd(), f).split(sep).join('/')).sort(),
    effortScope: skipEffort ? null : { fileCount: projectFiles.length, positiveControlOk: effortAvailable, positiveControlReason: positiveControl?.reason ?? null },
    refactoringTypes: [
      'extract-method', 'extract-class', 'introduce-parameter-object',
      'replace-magic-number', 'consolidate-duplicate-code', 'decompose-conditional',
      'strategy-transform', 'factory-transform', 'null-object-transform',
    ],
  };

  if (format === 'json') {
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const r of results) {
      for (const u of r.units) {
        if (u.totalFindings === 0) continue;
        const effortLine = u.effort ? ` — effort: ${u.effort.effort ?? 'unmeasured'} (${u.effort.criterion}, ${u.effort.callSites} call site(s))` : '';
        console.log(`${r.file} :: ${u.unit} (${u.kind}) — ${u.totalFindings} finding(s)${effortLine}`);
        for (const rule of Object.values(u.rules)) {
          for (const f of rule.findings) console.log(`  [${rule.refactoringType}] [${rule.confidence}] ${f.location} — ${f.detail}`);
        }
      }
    }
    if (!skipEffort) {
      console.log(effortAvailable
        ? `\nEffort scan: positive control OK (${positiveControl.referenceCount} reference(s) found for a known-used symbol) — ${projectFiles.length} file(s) in scope.`
        : `\nEffort scan: SKIPPED — positive control failed (${positiveControl?.reason ?? 'unknown'}). Every finding reports effort as unmeasured.`);
    }
    if (unresolvedLanguages.length) {
      console.log(`\n${unresolvedLanguages.length} file(s) matched no registered language plugin — skipped, not silently passed.`);
    }
  }

  process.exit(0);
}

function realFileURL(p) {
  try { return pathToFileURL(realpathSync(p)).href; } catch { return pathToFileURL(p).href; }
}
const isMain = process.argv[1] && import.meta.url === realFileURL(process.argv[1]);
if (isMain) main().catch((err) => { console.error(err); process.exit(2); });
