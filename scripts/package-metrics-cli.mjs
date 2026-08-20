#!/usr/bin/env node
/**
 * package-metrics-cli — thin CLI wrapper over lib/package-metrics.mjs.
 *
 * Discovers sibling package directories under a monorepo `packages/` root
 * (or a caller-supplied explicit list) and prints Ca/Ce/instability/
 * abstractness/distance-from-main-sequence/cycles/zone for each.
 *
 * Usage:
 *   node package-metrics-cli.mjs <packagesRoot> [--format text|json]
 *   node package-metrics-cli.mjs --dirs <dir1,dir2,...> [--format text|json]
 *
 * Exit code is always 0 — this is a reporting tool, not a gate. A future
 * `--fail-on zone-of-pain,adp` could add gating; not built tonight because
 * nothing asked for it and a fabricated gate threshold would be exactly the
 * kind of number this whole file exists to avoid inventing.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

import { packageMetricsAll } from './lib/package-metrics.mjs';

function parseArgs(argv) {
  const args = { format: 'text', root: null, dirs: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format') args.format = argv[++i];
    else if (a === '--dirs') args.dirs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else rest.push(a);
  }
  if (rest.length) args.root = rest[0];
  return args;
}

function discoverPackageDirs(root) {
  if (!existsSync(root)) throw new Error(`packages root does not exist: ${root}`);
  return readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
}

function fmtNum(n, digits = 3) {
  return n === null ? 'null' : n.toFixed(digits);
}

function printText(results) {
  const rows = results.map((r) => ({
    name: r.name,
    ca: String(r.ca),
    ce: String(r.ce),
    I: fmtNum(r.instability),
    A: fmtNum(r.abstractness),
    basis: r.abstractnessBasis,
    D: fmtNum(r.distanceFromMainSequence),
    zone: r.zone,
    cycles: r.cycles.length ? r.cycles.map((c) => c.join(' -> ')).join(' | ') : '-',
  }));
  const cols = ['name', 'ca', 'ce', 'I', 'A', 'basis', 'D', 'zone', 'cycles'];
  const widths = Object.fromEntries(
    cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]),
  );
  const line = (r) => cols.map((c) => String(r[c]).padEnd(widths[c])).join('  ');
  console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
  console.log(cols.map((c) => '-'.repeat(widths[c])).join('  '));
  for (const r of rows) console.log(line(r));

  const cyclesFound = results.filter((r) => r.cycles.length);
  if (cyclesFound.length) {
    console.log('');
    console.log('ADP violations (real cycle paths):');
    for (const r of cyclesFound) {
      for (const c of r.cycles) console.log(`  ${c.join(' -> ')}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let dirs;
  if (args.dirs) dirs = args.dirs.map((d) => path.resolve(d));
  else if (args.root) dirs = discoverPackageDirs(path.resolve(args.root));
  else {
    console.error('Usage: node package-metrics-cli.mjs <packagesRoot> [--format text|json]');
    console.error('       node package-metrics-cli.mjs --dirs <dir1,dir2,...> [--format text|json]');
    process.exit(1);
  }

  const results = packageMetricsAll(dirs);
  if (args.format === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printText(results);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  main().catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
}

export { discoverPackageDirs, parseArgs };
