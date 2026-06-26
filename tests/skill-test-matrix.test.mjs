#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { loadAllManifests } from '../scripts/lib/manifest-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const testsDir = join(root, 'skills', 'tests');
const matrixPath = join(testsDir, 'MATRIX.md');
const readmePath = join(testsDir, 'README.md');

const manifestFiles = readdirSync(testsDir).filter((name) => name.endsWith('.test.json')).sort();
const manifests = loadAllManifests(testsDir);
const valid = manifests.filter((entry) => entry.ok && entry.manifest);
const matrix = readFileSync(matrixPath, 'utf8');
const readme = readFileSync(readmePath, 'utf8');

assert.equal(valid.length, manifestFiles.length, 'all manifest files must validate');
assert.match(matrix, new RegExp(`Current coverage: ${manifestFiles.length} manifests for ${manifestFiles.length} skill directories`));
assert.match(readme, new RegExp(`There are currently ${manifestFiles.length} manifests for ${manifestFiles.length} skill directories`));

const rows = new Map();
for (const line of matrix.split(/\r?\n/)) {
  const m = line.match(/^\| `([^`]+)` \| `([^`]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);
  if (!m) continue;
  rows.set(m[1], {
    manifest: m[2],
    promptClass: m[3].trim(),
    assertions: m[4].replace(/`/g, '').trim(),
    acceptanceDepth: m[5].trim(),
  });
}

assert.equal(rows.size, manifestFiles.length, 'MATRIX.md must list every manifest exactly once');

for (const entry of valid) {
  const manifest = entry.manifest;
  const filename = entry.file.replace(/^skills\/tests\//, '');
  const row = rows.get(manifest.skill);
  assert.ok(row, `${manifest.skill} missing from MATRIX.md`);
  assert.equal(row.manifest, filename, `${manifest.skill} matrix filename mismatch`);

  for (const key of Object.keys(manifest.assertions || {}).sort()) {
    assert.match(row.assertions, new RegExp(`(^|, )${key}(,|$)`), `${manifest.skill} matrix must mention assertion ${key}`);
  }

  const hasAcceptance = manifest.acceptance && Object.keys(manifest.acceptance).length > 0;
  if (hasAcceptance) {
    assert.notEqual(row.acceptanceDepth, 'Basic manifest', `${manifest.skill} has acceptance checks but matrix says Basic manifest`);
  } else {
    assert.equal(row.acceptanceDepth, 'Basic manifest', `${manifest.skill} has no acceptance block and should be documented as Basic manifest`);
  }
}

const shallow = valid
  .map((entry) => entry.manifest)
  .filter((manifest) => !manifest.acceptance || Object.keys(manifest.acceptance).length === 0)
  .map((manifest) => manifest.skill);
assert.deepEqual(shallow, [], `all skill manifests must include acceptance checks; missing: ${shallow.join(', ')}`);
assert.match(matrix, /All manifests now include a deeper acceptance block/);

console.log('skill test matrix tests — PASS');
