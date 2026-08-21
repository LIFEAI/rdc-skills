#!/usr/bin/env node
/**
 * rdc-duplication-score — G5 Clean Code rule, CLI.
 * See scripts/lib/duplication-scoring.mjs for the algorithm and provenance.
 */
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDuplicates } from './lib/duplication-scoring.mjs';

function walkFiles(dir, exts, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, exts, out);
    else if (exts.includes(extname(entry.name))) out.push(full);
  }
  return out;
}

function printHelp() {
  console.log(`rdc-duplication-score <path> [--min-tokens <n>] [--format text|json]

Detects G5 (Duplicate Code) via token-shingle Rabin-Karp matching across all
files under <path>. Default --min-tokens 50 (matches PMD CPD's default).`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }
  const positional = args.filter((a) => !a.startsWith('--'));
  const target = resolve(positional[0]);
  const minTokensIdx = args.indexOf('--min-tokens');
  const minTokens = minTokensIdx !== -1 ? Number(args[minTokensIdx + 1]) : 50;
  const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : 'text';

  const exts = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py'];
  const st = statSync(target);
  const files = st.isDirectory() ? walkFiles(target, exts) : [target];

  const fileRecords = files.map((f) => ({
    file: relative(process.cwd(), f).split('\\').join('/'),
    text: readFileSync(f, 'utf8'),
    ext: extname(f),
  }));

  const result = findDuplicates(fileRecords, minTokens);

  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`G5 Duplicate Code — ${result.filesScanned} file(s) scanned, min ${minTokens} tokens`);
    for (const d of result.duplicates) {
      console.log(`\n${d.tokenCount}+ token block found in ${d.occurrences.length} location(s):`);
      for (const o of d.occurrences) console.log(`  ${o.file}:${o.startLine}-${o.endLine}`);
    }
    console.log(`\n${result.duplicates.length} duplicate block(s) found.`);
  }
  process.exit(0);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
