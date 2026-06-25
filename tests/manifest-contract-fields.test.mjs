#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));

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

console.log('manifest contract field tests — PASS');
