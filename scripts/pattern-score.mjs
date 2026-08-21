#!/usr/bin/env node
/**
 * pattern-score — mechanical design-pattern-opportunity scorer, language-
 * plugin-based, same architecture as solid-score.mjs / clean-code-score.mjs:
 * this CLI owns argv parsing, file walking, and output formatting. It does
 * NOT know what an AST node is — every fact comes from
 * `lib/plugins/typescript.mjs` via the `lib/language-plugin.mjs` contract,
 * and every detector is a pure function in `lib/pattern-scoring.mjs`.
 *
 * Detects 9 patterns — Factory Method, Builder, Singleton (creational),
 * Decorator, Adapter, Facade (structural), Strategy, Observer, Command,
 * Template Method (behavioral) — ported from architecture-toolkit's real
 * `src/agents/pattern-advisor/tools/*-pattern-analyzer.ts` (MIT,
 * github.com/OnSightTeam/architecture-toolkit). See
 * lib/pattern-scoring.mjs's header for the full citation and porting
 * rationale, and skills/pattern-advisor/SKILL.md for the confidence
 * calibration this scorer's hard-coded numbers were checked against.
 *
 * ATF-compatibility: `--format json` output is byte-identical across repeat
 * runs on unchanged input — no timestamps, no absolute paths (file paths are
 * relative to the scanned root), and both the file list and each unit's
 * per-pattern findings are explicitly sorted (file path; then unit name;
 * then, within a pattern, line-then-location — see pattern-scoring.mjs's
 * `patternScore`).
 *
 * Usage:
 *   node pattern-score.mjs <path> [--format text|json] [--help]
 */

import { readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { registerPlugin, pluginFor } from './lib/language-plugin.mjs';
import { typescriptPlugin } from './lib/plugins/typescript.mjs';
import { patternScore, PATTERN_NAMES } from './lib/pattern-scoring.mjs';

registerPlugin(typescriptPlugin);
// A future Python plugin registers here too — nothing else in this file changes.

const EXCLUDE_DIRS = new Set(['node_modules', '.git']);

/** Recursive file walk, directory entries sorted so traversal order (and
 * therefore the resulting file list) is stable across runs and platforms —
 * `readdirSync`'s own order is filesystem-dependent, not a language
 * guarantee. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
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

const HELP = `pattern-score — mechanical design-pattern-opportunity scorer

Usage:
  node pattern-score.mjs <path> [--format text|json]

Detects 9 patterns ported from architecture-toolkit's real pattern-advisor
analyzers (MIT, github.com/OnSightTeam/architecture-toolkit):
  Creational: Factory Method, Builder, Singleton
  Structural: Decorator, Adapter, Facade
  Behavioral: Strategy, Observer, Command, Template Method

Options:
  --format text|json   Output format (default: text)
  --help, -h           Show this help
`;

async function main() {
  if (flag('--help') || flag('-h')) { console.log(HELP); process.exit(0); }

  const rawTarget = process.argv[2]?.startsWith('--') ? process.cwd() : (process.argv[2] ?? process.cwd());
  const targetPath = normalizePath(rawTarget);
  const format = arg('--format', 'text');

  if (!existsSync(targetPath)) throw new Error(`target path does not exist: ${targetPath}`);
  const isFile = statSync(targetPath).isFile();
  const rootForRelative = isFile ? dirname(targetPath) : targetPath;
  const targetFiles = isFile ? [targetPath] : walk(targetPath);
  const scannedFiles = targetFiles.filter((f) => pluginFor(f)).sort();
  const unresolvedLanguages = targetFiles.filter((f) => !pluginFor(f)).sort();

  const results = [];
  for (const f of scannedFiles) {
    const plugin = pluginFor(f);
    const units = plugin.extractUnits(f);
    const scored = units.map((u) => patternScore(u)).filter((s) => s.totalFindings > 0);
    if (scored.length) {
      scored.sort((a, b) => a.unit.localeCompare(b.unit));
      results.push({ file: relative(rootForRelative, f).split(sep).join('/'), units: scored });
    }
  }
  results.sort((a, b) => a.file.localeCompare(b.file));

  const output = { results, unresolvedLanguages, patternCatalog: PATTERN_NAMES };

  if (format === 'json') {
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const r of results) {
      for (const u of r.units) {
        console.log(`${r.file} :: ${u.unit} (${u.kind}) — ${u.totalFindings} pattern finding(s)`);
        for (const [patternName, det] of Object.entries(u.patterns)) {
          for (const f of det.findings) {
            console.log(`  [${patternName}] [${f.confidence}%/${f.priority}] ${f.location} — ${f.problem}`);
          }
        }
      }
    }
    if (!results.length) console.log('No pattern findings.');
    if (unresolvedLanguages.length) {
      console.log(`\n${unresolvedLanguages.length} file(s) matched no registered language plugin — skipped, not silently passed.`);
    }
    console.log(`\nPatterns checked: ${PATTERN_NAMES.join(', ')}`);
  }

  process.exit(0);
}

function realFileURL(p) {
  try { return pathToFileURL(realpathSync(p)).href; } catch { return pathToFileURL(p).href; }
}
const isMain = process.argv[1] && import.meta.url === realFileURL(process.argv[1]);
if (isMain) main().catch((err) => { console.error(err); process.exit(2); });
