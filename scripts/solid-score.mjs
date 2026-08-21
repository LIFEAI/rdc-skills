#!/usr/bin/env node
/**
 * solid-score — SOLID + Clean Architecture scoring, language-plugin-based.
 *
 * This CLI is deliberately language-agnostic. It owns: argv parsing, config
 * loading, git-diff orchestration, the boundary-rule check, and output
 * formatting. It does NOT know what an AST node is — every fact about source
 * code comes from whichever plugin in `lib/plugins/` claims the file
 * (see lib/language-plugin.mjs for the contract). Day 1 ships one plugin
 * (TypeScript/JavaScript, via ts-morph). Adding Python later means writing
 * `lib/plugins/python.mjs` against the same contract — nothing in this file
 * changes.
 *
 * It does not persist a baseline file. `--diff <ref>` scores each changed
 * unit TWICE — once at <ref> via `git show`, once against the CURRENT
 * WORKING TREE (uncommitted and untracked changes included, not just what's
 * been committed) — and gates on the delta. `git diff --name-only <ref>`
 * (no `...HEAD`) compares the ref directly against the working directory,
 * which also means the "before" side (`git show <ref>:<path>`) and the file
 * list are read from the exact same commit — no separate merge-base to fall
 * out of sync with it.
 *
 * A SEPARATE, non-SOLID check rides alongside the five letters: Clean
 * Architecture's dependency rule — an orchestrator module declared to own a
 * set of ports must actually import and delegate to them, not reimplement
 * their logic inline. Dogfooded proof this matters: `rdc-harness`'s `Harness`
 * god-object scores 68.5/100 on the plain weighted SOLID sum (DIP alone
 * doesn't catch it — a class with almost no dependencies of ANY kind scores
 * fine on concrete-instantiation ratio) but fails the boundary check outright
 * on all six of its declared ports.
 *
 * A per-consumer-repo config lives at `<repo>/.solid-score.yml` — this
 * package ships no default boundary rules of its own; each repo declares
 * its own orchestrator/port pairs.
 *
 * Usage:
 *   node solid-score.mjs <path> [--config <file>] [--diff <ref>]
 *     [--format text|json] [--parser tree-sitter|ts-morph]
 *
 * `--parser` selects the AST backend (default `tree-sitter`, see the
 * PARSER_PLUGINS block below for why).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { registerPlugin, pluginFor } from './lib/language-plugin.mjs';
import { typescriptPlugin } from './lib/plugins/typescript.mjs';
import { treesitterPlugin } from './lib/plugins/treesitter.mjs';
import { scoreUnit } from './lib/solid-scoring.mjs';

// AST backend selection — `--parser tree-sitter|ts-morph`, default
// `tree-sitter` per direct operator instruction (Dave, 2026-08-20): the
// fleet's own standalone, in-process, multi-language tree-sitter parser
// (ported from CodeFlow's `packages/codeflow-parser/src/nativeParser.ts`,
// see scripts/lib/plugins/treesitter.mjs's own header for the full port
// citation) replaces the third-party TS-only ts-morph backend as the
// default for this CLI. `--parser ts-morph` stays available as an escape
// hatch/regression-comparison lever, not a silent removal — ts-morph
// remains the backend the other 3 ts-morph tools (clean-code-score,
// pattern-score, refactoring-score) use this pass; only SOLID moves.
const PARSER_PLUGINS = { 'tree-sitter': treesitterPlugin, 'ts-morph': typescriptPlugin };

const parserArgIndex = process.argv.indexOf('--parser');
const parserName = parserArgIndex !== -1 ? process.argv[parserArgIndex + 1] : 'tree-sitter';
if (!PARSER_PLUGINS[parserName]) {
  throw new Error(`--parser must be one of ${Object.keys(PARSER_PLUGINS).join('|')}, got "${parserName}"`);
}
// Register only the SELECTED plugin — typescriptPlugin and treesitterPlugin
// both claim the identical file-extension set (canHandle), so registering
// both would make `pluginFor()` always resolve to whichever was registered
// first regardless of `--parser`, silently ignoring the flag.
registerPlugin(PARSER_PLUGINS[parserName]);
// A future Python plugin registers here too — nothing else in this file changes.

export const DEFAULT_CONFIG = {
  weights: { srp: 0.20, ocp: 0.15, lsp: 0.15, isp: 0.20, dip: 0.30 },
  thresholds: null, // not implemented — see skills/solid-validator/SKILL.md "Known gaps"; left null so a config setting it is visibly ignored rather than silently accepted
  diff: { maxDecrease: 0, newUnitMin: 0 },
  exclude: ['**/test/**', '**/*.test.*', '**/node_modules/**'],
  boundaries: [], // [{ orchestrator: glob, requiredPorts: [glob, ...] }]
};

/**
 * A config path that was explicitly PASSED and does not exist is a user
 * error, not "use defaults" — an absent `--config` flag (no path at all)
 * legitimately means "no config, use defaults". Before this fix the two
 * were indistinguishable: a typo'd path silently produced `boundaries: []`
 * and a clean exit 0, and every SKILL.md-documented invocation of this tool
 * pointed at `.solid-score.yml`, a filename that existed in no repo tonight
 * — so the Clean Architecture gate ran with zero configured rules on every
 * documented call site.
 */
export function loadConfig(path) {
  if (!path) return { config: structuredClone(DEFAULT_CONFIG), configPath: null, configLoaded: false };
  if (!existsSync(path)) throw new Error(`--config ${path} does not exist`);
  const raw = parseYaml(readFileSync(path, 'utf8'));
  const config = {
    ...structuredClone(DEFAULT_CONFIG), ...raw,
    weights: { ...DEFAULT_CONFIG.weights, ...(raw.weights ?? {}) },
    diff: { ...DEFAULT_CONFIG.diff, ...(raw.diff ?? {}) },
  };
  return { config, configPath: path, configLoaded: true };
}

const GLOB_STAR_TOKEN = '\u0001GLOBSTAR\u0001';

/**
 * Real glob-to-regex, not a globstar-strip substring check — a single `*`
 * in a user config previously survived as a literal character and matched
 * nothing. Built with string split/join rather than regex-literal replace
 * to sidestep a tool encoding issue that corrupted a prior version of this
 * function with embedded NUL bytes at the globstar/space substitution
 * points — confirmed byte-for-byte with a raw scan before rewriting.
 */
function globToRegExp(glob) {
  const specialChars = ['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']'];
  let escaped = glob;
  for (const ch of specialChars) escaped = escaped.split(ch).join(`\\${ch}`);
  const withGlobstar = escaped.split('**').join(GLOB_STAR_TOKEN);
  const withStar = withGlobstar.split('*').join('[^/]*');
  const final = withStar.split(GLOB_STAR_TOKEN).join('.*');
  return new RegExp(`(^|/)${final}$|(^|/)${final}(/|$)`);
}

function isExcluded(relPath, exclude) {
  return exclude.some((p) => globToRegExp(p).test(relPath));
}

/** Recursive file walk — no glob library, so no more languages than plugins to add here either. */
function walk(dir, exclude, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) walk(full, exclude, out);
    else if (!isExcluded(full.split(sep).join('/'), exclude)) out.push(full);
  }
  return out;
}

/** Score a file's text as it existed at a given git ref, without touching the working tree. */
function scoreAtRef(repoRoot, filePath, ref, weights) {
  const relPath = relative(repoRoot, filePath).split('\\').join('/');
  let text;
  try {
    text = execFileSync('git', ['show', `${ref}:${relPath}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    // `git show` fails both when the file is genuinely new at `ref` AND for
    // unrelated reasons (a path-form mismatch, a bad ref). Collapsing both
    // into "it's new" hides the second case — the exact class of silent
    // path-form bug found three times in this file already tonight. Only a
    // "does not exist" message is treated as new; anything else is rethrown.
    const msg = String(err.stderr ?? err.message ?? '');
    if (msg.includes('does not exist in') || msg.includes('fatal: path') && msg.includes('does not exist')) return null;
    throw err;
  }
  const plugin = pluginFor(filePath);
  if (!plugin) return null;
  return plugin.extractUnits(filePath, text).map((u) => scoreUnit(u, weights));
}

/**
 * Does `orchestrator` import from every `requiredPorts` glob it's declared
 * to own? Both fields are documented as globs; a rule that matches zero
 * files is a config error (typo'd path, moved file) and MUST be reported —
 * silently passing zero matches makes a misconfigured rule indistinguishable
 * from a satisfied one.
 */
function checkBoundaries(files, boundaries, repoRoot) {
  const findings = [];
  const misconfigured = [];
  for (const rule of boundaries) {
    const orchestratorRe = globToRegExp(rule.orchestrator.split('\\').join('/'));
    const matched = files.filter((f) => orchestratorRe.test(relative(repoRoot, f).split('\\').join('/')));
    if (!matched.length) { misconfigured.push({ rule: rule.orchestrator, reason: 'matched zero files in the scanned set' }); continue; }
    for (const f of matched) {
      const plugin = pluginFor(f);
      if (!plugin) continue;
      const importPaths = plugin.importsOf(f);
      for (const port of rule.requiredPorts) {
        const portRe = globToRegExp(port);
        const substringFallback = port.split('**')[0].replace(/^\.\//, '');
        findings.push({ file: relative(repoRoot, f), requiredPort: port, satisfied: importPaths.some((p) => portRe.test(p) || p.includes(substringFallback)) });
      }
    }
  }
  return { findings, misconfigured };
}

// ── CLI ──────────────────────────────────────────────────────────────────

function arg(name, fallback = null) { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; }

/**
 * Bash-tool / MSYS argv can hand this process a POSIX-shaped path
 * (`/c/Dev/...`) even though this is native Windows node. The filesystem
 * layer only resolves Windows-shaped paths — a POSIX path fails silently
 * upstream of any error message. Normalize before use.
 */
function normalizePath(p) {
  const m = /^\/([A-Za-z])\/(.*)$/.exec(p);
  const windowsShaped = m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
  // A relative arg ("packages/core/src/index.mjs") must become absolute
  // BEFORE any downstream comparison — the boundary check always builds its
  // side of the match from repoRoot-absolute paths, so a relative target
  // silently matches nothing.
  const abs = resolve(process.cwd(), windowsShaped);
  // realpathSync so a path reached through a symlink/junction compares
  // equal to repoRoot (derived from `git rev-parse`, which reports the real
  // path) — the same symlink-vs-original mismatch that broke the isMain
  // check under `npm link` also applies to any target path reached that way.
  try { return realpathSync(abs); } catch { return abs; }
}

async function main() {
  const rawTarget = process.argv[2]?.startsWith('--') ? process.cwd() : (process.argv[2] ?? process.cwd());
  const targetPath = normalizePath(rawTarget);
  const configArg = arg('--config');
  const { config, configPath, configLoaded } = loadConfig(configArg ? normalizePath(configArg) : null);
  const diffRef = arg('--diff');
  const format = arg('--format', 'text');

  if (!existsSync(targetPath)) throw new Error(`target path does not exist: ${targetPath}`);
  const isFile = statSync(targetPath).isFile();

  // A plain (non-diff) score does not need a git repo at all — only resolve
  // repoRoot when it's actually needed (diff mode, or a boundary check that
  // needs repo-root-relative paths).
  const needsGit = Boolean(diffRef) || (config.boundaries ?? []).length > 0;
  let repoRoot = isFile ? dirname(targetPath) : targetPath;
  if (needsGit) {
    const cwdForGit = isFile ? dirname(targetPath) : targetPath;
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: cwdForGit, encoding: 'utf8' }).trim();
  }

  let files;
  if (diffRef) {
    // `git diff --name-only <ref> -- <path>` (no `...HEAD`) compares `<ref>`
    // directly against the WORKING TREE — committed history AND uncommitted
    // changes both show up. Untracked new files show up in neither `git
    // diff` form, so they're unioned in separately. Before this fix, only
    // `<ref>...HEAD` (committed history alone) was scored — a dirty tree
    // with real regressions scored zero files and exited 0.
    const committed = execFileSync('git', ['diff', '--name-only', diffRef, '--', targetPath], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n').filter(Boolean);
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', targetPath], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n').filter(Boolean);
    files = [...new Set([...committed, ...untracked])]
      .map((f) => join(repoRoot, f))
      .filter((f) => !isExcluded(f.split(sep).join('/'), config.exclude));
  } else if (isFile) {
    files = [targetPath];
  } else {
    files = walk(targetPath, config.exclude);
  }

  const results = [];
  const regressions = [];
  const unresolvedLanguages = [];

  for (const f of files) {
    const plugin = pluginFor(f);
    if (!plugin) { unresolvedLanguages.push(f); continue; } // reachable now — files are no longer pre-filtered by pluginFor before reaching this loop
    const current = plugin.extractUnits(f).map((u) => scoreUnit(u, config.weights));

    if (diffRef) {
      const before = scoreAtRef(repoRoot, f, diffRef, config.weights);
      for (const unit of current) {
        if (unit.total === null) continue; // fully unmeasured — nothing to compare
        const prior = before?.find((b) => b.unit === unit.unit);
        if (!prior || prior.total === null) {
          if (unit.total < config.diff.newUnitMin) regressions.push({ file: f, unit: unit.unit, reason: 'new_unit_below_min', total: unit.total, min: config.diff.newUnitMin });
        } else if (prior.total - unit.total > config.diff.maxDecrease) {
          regressions.push({ file: f, unit: unit.unit, reason: 'regression', before: prior.total, after: unit.total });
        }
      }
    }
    results.push({ file: relative(repoRoot, f).split('\\').join('/'), units: current });
  }

  const { findings: boundaryFindings, misconfigured: boundaryMisconfigured } = checkBoundaries(files, config.boundaries ?? [], repoRoot);
  const boundaryViolations = boundaryFindings.filter((f) => !f.satisfied);

  const output = {
    results, regressions, boundaryFindings, boundaryViolations, boundaryMisconfigured, unresolvedLanguages,
    config: { weights: config.weights, diff: config.diff, boundaryRuleCount: (config.boundaries ?? []).length },
    configPath, configLoaded,
    parser: parserName,
  };

  if (format === 'json') {
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const r of results) {
      for (const u of r.units) {
        console.log(`${r.file} :: ${u.unit} (${u.kind})  total=${u.total ?? 'UNMEASURED'}`);
        for (const [k, v] of Object.entries(u.criteria)) console.log(`  ${k.toUpperCase()}: ${v.score.toString().padStart(3)}  [${v.confidence}]  ${v.detail}`);
      }
    }
    if (boundaryViolations.length) {
      console.log('\nCLEAN ARCHITECTURE BOUNDARY VIOLATIONS:');
      for (const v of boundaryViolations) console.log(`  ${v.file}: missing required port import '${v.requiredPort}'`);
    }
    if (boundaryMisconfigured.length) {
      console.log('\nBOUNDARY RULES MATCHING ZERO FILES (config error, not a pass):');
      for (const m of boundaryMisconfigured) console.log(`  orchestrator '${m.rule}' — ${m.reason}`);
    }
    if (regressions.length) {
      console.log('\nREGRESSIONS:');
      for (const r of regressions) console.log(`  ${r.file} :: ${r.unit} — ${r.reason} ${JSON.stringify(r)}`);
    }
    if (unresolvedLanguages.length) {
      console.log(`\n${unresolvedLanguages.length} file(s) matched no registered language plugin — skipped, not silently passed:`);
      for (const f of unresolvedLanguages) console.log(`  ${relative(repoRoot, f)}`);
    }
    if ((config.boundaries ?? []).length === 0) {
      console.log(configLoaded ? '\nNo boundary rules configured — Clean Architecture check has nothing to verify.' : '\nNo --config given — running with defaults, zero boundary rules. Pass --config <repo>/.solid-score.yml to enable the Clean Architecture check.');
    }
  }

  const failed = regressions.length > 0 || boundaryViolations.length > 0 || boundaryMisconfigured.length > 0;
  process.exit(failed ? 1 : 0);
}

// `import.meta.url` resolves through symlinks to the real path; a plain
// `pathToFileURL(process.argv[1])` does not. Under `npm link` (a symlinked
// global bin — exactly how this tool got installed) the two disagreed and
// main() silently never ran, on every invocation, with exit 0 and no output.
// realpathSync on both sides closes that gap.
function realFileURL(p) {
  try { return pathToFileURL(realpathSync(p)).href; } catch { return pathToFileURL(p).href; }
}
const isMain = process.argv[1] && import.meta.url === realFileURL(process.argv[1]);
if (isMain) main().catch((err) => { console.error(err); process.exit(2); });
