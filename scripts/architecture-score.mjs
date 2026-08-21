#!/usr/bin/env node
/**
 * architecture-score — mechanical Clean Architecture boundary / dependency-
 * direction / layer-separation scoring, ported from
 * github.com/OnSightTeam/architecture-toolkit (MIT) — see
 * `lib/architecture-scoring.mjs`'s header for the full provenance and what
 * was deliberately NOT ported (the toolkit's own broken circular-dependency
 * check).
 *
 * Same architecture as `package-metrics-cli.mjs`: this file owns argv
 * parsing, file discovery, config loading, and output formatting. It does
 * NOT know what an AST is — `lib/architecture-scoring.mjs` is plain
 * `node:fs` + regex/path parsing, independent of the ts-morph
 * `language-plugin.mjs` used by SOLID/clean-code.
 *
 * Config (`--config <file>`, YAML) — same loading discipline as
 * `solid-score.mjs`'s `--config`: an explicitly-passed path that doesn't
 * exist is an error, not a silent fallback to defaults; an absent flag
 * legitimately means "use `DEFAULT_LAYERS`."
 *
 *   layers:
 *     - name: Entities
 *       level: 4
 *       globs: ["**\/entities/**", "**\/domain/**"]
 *
 * Usage:
 *   node architecture-score.mjs <path> [--config <file>] [--format text|json]
 *
 * DETERMINISM (ATF golden-record requirement): file walk order is sorted
 * (see `walkSourceFiles`), every finding array is emitted in a stable order
 * (files sorted by relPath, rule keys in a fixed object-literal order,
 * cycles canonicalized+sorted), no absolute paths in output (every
 * `location` is scan-root-relative), no timestamps. Verified by running
 * this CLI twice against the same target and diffing — see the task report
 * for the actual command and its empty diff.
 *
 * Exit code is always 0 — a reporting tool, not a gate (same policy as
 * `package-metrics-cli.mjs`; nothing asked for a `--fail-on` this round).
 */

import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { walkSourceFiles, architectureScoreAll, DEFAULT_LAYERS } from './lib/architecture-scoring.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

/**
 * Bash-tool / MSYS argv can hand this native-Windows process a POSIX-shaped
 * path — normalize before use. Same fix as solid-score.mjs / clean-code-score.mjs.
 */
function normalizePath(p) {
  const m = /^\/([A-Za-z])\/(.*)$/.exec(p);
  const windowsShaped = m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
  const abs = path.resolve(process.cwd(), windowsShaped);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

export function loadConfig(configPath) {
  if (!configPath) return { layers: DEFAULT_LAYERS, configPath: null, configLoaded: false };
  if (!existsSync(configPath)) throw new Error(`--config ${configPath} does not exist`);
  const raw = parseYaml(readFileSync(configPath, 'utf8')) ?? {};
  const layers = raw.layers ?? DEFAULT_LAYERS;
  return { layers, configPath, configLoaded: true };
}

function printHelp() {
  console.error('Usage: node architecture-score.mjs <path> [--config <file>] [--format text|json]');
  console.error('');
  console.error('  <path>            file or directory to scan (required)');
  console.error('  --config <file>   YAML file with a `layers:` section (see lib/architecture-scoring.mjs header). Default: DEFAULT_LAYERS (Entities/UseCases/InterfaceAdapters/Frameworks).');
  console.error('  --format          text (default) or json');
}

function printText(output) {
  for (const r of output.results) {
    if (r.totalFindings === 0) continue;
    console.log(`${r.file}  [layer: ${r.layer ?? 'UNCLASSIFIED'}${r.layer ? ` via ${r.layerBasis}` : ''}]  — ${r.totalFindings} finding(s)`);
    for (const rule of Object.values(r.rules)) {
      for (const f of rule.findings) {
        console.log(`  [${rule.ruleId}] [${f.severity}] [${f.confidence}] ${f.detail}`);
      }
    }
  }
  if (output.circularLayerDependency.findings.length) {
    console.log('\nCIRCULAR LAYER DEPENDENCIES:');
    for (const f of output.circularLayerDependency.findings) console.log(`  ${f.location}`);
  } else {
    console.log('\nNo circular layer dependencies found.');
  }
  if (output.unclassifiedFiles.length) {
    console.log(`\n${output.unclassifiedFiles.length} file(s) matched no configured layer (path or name-hint) — skipped by every layer-aware rule, not silently passed as any specific layer:`);
    for (const f of output.unclassifiedFiles) console.log(`  ${f}`);
  }
  console.log(`\nLayers in effect: ${output.layers.map((l) => `${l.name}(${l.level})`).join(' > ')}`);
}

async function main() {
  const rawTarget = process.argv[2]?.startsWith('--') ? null : process.argv[2];
  if (!rawTarget) {
    printHelp();
    process.exit(1);
  }
  const targetPath = normalizePath(rawTarget);
  const configArg = arg('--config');
  const format = arg('--format', 'text');

  if (!existsSync(targetPath)) throw new Error(`target path does not exist: ${targetPath}`);
  const { layers, configPath, configLoaded } = loadConfig(configArg ? normalizePath(configArg) : null);

  const isFile = statSync(targetPath).isFile();
  const root = isFile ? path.dirname(targetPath) : targetPath;
  const files = isFile ? [targetPath] : walkSourceFiles(targetPath);

  const scored = architectureScoreAll(files, root, { layers });
  const output = {
    results: scored.results,
    circularLayerDependency: scored.circularLayerDependency,
    unclassifiedFiles: scored.unclassifiedFiles,
    layers: scored.layers,
    config: { configPath, configLoaded, layerRuleCount: layers.length },
  };

  if (format === 'json') {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printText(output);
  }

  process.exit(0);
}

function realFileURL(p) {
  try {
    return pathToFileURL(realpathSync(p)).href;
  } catch {
    return pathToFileURL(p).href;
  }
}
const isMain = process.argv[1] && import.meta.url === realFileURL(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err.stack || String(err));
    process.exit(2);
  });
}

export { normalizePath };
