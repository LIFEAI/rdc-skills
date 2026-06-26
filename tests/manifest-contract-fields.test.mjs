#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const skillDirs = readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'tests')
  .map((entry) => entry.name)
  .sort();
const metaNames = Object.keys(manifest.skills_meta).sort();
const manifestSlashes = new Set(Object.values(manifest.skills_meta).map((meta) => meta.slash));

assert.deepEqual(
  metaNames,
  skillDirs,
  'Every skills/<name>/SKILL.md directory must have a skills_meta entry so MCP/help use explicit caller-facing terms',
);

function skillPath(name) {
  const direct = join(root, 'skills', name, 'SKILL.md');
  if (existsSync(direct)) return direct;
  const prefixed = join(root, 'skills', `rdc-${name}`, 'SKILL.md');
  if (existsSync(prefixed)) return prefixed;
  return direct;
}

for (const [name, meta] of Object.entries(manifest.skills_meta)) {
  const file = skillPath(name);
  assert.equal(existsSync(file), true, `${name} must have a SKILL.md`);
  const body = readFileSync(file, 'utf8');

  assert.equal(meta.name, name, `${name} manifest name must match its skills_meta key`);
  assert.doesNotMatch(meta.slash, /^rdc:rdc-/, `${name} slash command must not be a synthesized rdc:rdc-* name`);
  assert.doesNotMatch(meta.slash, /^rdc:lifeai-/, `${name} slash command must not invent an rdc: prefix for non-rdc skills`);

  const hasOutputContract = body.includes('guides/output-contract.md') || body.includes('OUTPUT CONTRACT');
  assert.equal(
    Boolean(meta.output_contract),
    hasOutputContract,
    `${name} manifest output_contract must match SKILL.md banner`,
  );

  if (body.includes('RDC_TEST=1')) {
    assert.equal(meta.sandbox_aware, true, `${name} mentions RDC_TEST=1 and must be sandbox_aware`);
  }

  if (meta.sandbox_aware) {
    assert.match(
      body,
      /Sandbox contract|RDC_TEST=1/,
      `${name} is sandbox_aware and must explain the sandbox contract in SKILL.md`,
    );
  }
}

const testManifests = readdirSync(join(root, 'skills', 'tests'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.json'));

for (const entry of testManifests) {
  const testPath = join(root, 'skills', 'tests', entry.name);
  const test = JSON.parse(readFileSync(testPath, 'utf8'));
  assert.equal(
    manifestSlashes.has(test.skill),
    true,
    `${entry.name} skill "${test.skill}" must match a skills_meta[].slash value`,
  );
  assert.match(
    test.fixture?.prompt || '',
    new RegExp(`(^|\\s)${test.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`),
    `${entry.name} prompt must invoke its manifest skill name`,
  );
}

console.log('manifest contract field tests — PASS');
