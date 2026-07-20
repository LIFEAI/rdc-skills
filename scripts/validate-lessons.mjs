#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const required = ['id', 'date', 'skill', 'runtime', 'scope', 'lesson_status', 'area', 'needs_claude', 'links'];
const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = rootFlag >= 0 ? resolve(args[rootFlag + 1] || '.') : process.cwd();
const json = args.includes('--json');
const allowInvalid = args.includes('--allow-invalid');
const lessonsDir = resolve(root, '.rdc', 'lessons');

if (!existsSync(lessonsDir)) {
  throw new Error(`lessons directory not found: ${lessonsDir}`);
}

function firstFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { value: {}, end: 0, blockCount: 0 };
  const value = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/);
    if (!field) continue;
    value[field[1]] = (field[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
  }
  return {
    value,
    end: match[0].length,
    blockCount: (text.match(/^---\r?$/gm) ?? []).length / 2,
  };
}

const candidates = [];
for (const file of readdirSync(lessonsDir).filter((name) => name.endsWith('.md')).sort()) {
  const text = readFileSync(resolve(lessonsDir, file), 'utf8');
  const parsed = firstFrontmatter(text);
  const legacy = parsed.value.status === 'open' && !('lesson_status' in parsed.value);
  const malformedOpen = parsed.value.lesson_status !== 'open'
    && !legacy
    && /(?:^|\n)lesson_status:\s*open\s*$/m.test(text.slice(parsed.end));
  if (parsed.value.lesson_status !== 'open' && !legacy && !malformedOpen) continue;

  const missing = required.filter((field) => !(field in parsed.value));
  const invalid = legacy || malformedOpen || parsed.blockCount !== 1 || missing.length > 0;
  candidates.push({ file, legacy, malformed_open: malformedOpen, frontmatter_blocks: parsed.blockCount, missing, invalid });
}

const result = {
  root,
  candidate_count: candidates.length,
  invalid_count: candidates.filter((candidate) => candidate.invalid).length,
  candidates,
};

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`lessons candidates=${result.candidate_count} invalid=${result.invalid_count}`);
  for (const candidate of candidates.filter((entry) => entry.invalid)) {
    console.log(`${candidate.file}: legacy=${candidate.legacy} malformed_open=${candidate.malformed_open} blocks=${candidate.frontmatter_blocks} missing=${candidate.missing.join(',')}`);
  }
}

if (result.invalid_count > 0 && !allowInvalid) process.exitCode = 1;
