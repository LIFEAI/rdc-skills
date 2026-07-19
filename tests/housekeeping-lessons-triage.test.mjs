#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = readFileSync(join(root, 'skills', 'housekeeping', 'SKILL.md'), 'utf8');
const guide = readFileSync(join(root, 'guides', 'lessons-learned-spec.md'), 'utf8');

function mustAppearInOrder(text, fragments, name) {
  let previous = -1;
  for (const fragment of fragments) {
    const index = text.indexOf(fragment);
    assert.notEqual(index, -1, `${name} is missing: ${fragment}`);
    assert.ok(index > previous, `${name} orders ${fragment} before its required predecessor`);
    previous = index;
  }
}

assert.match(skill, /lesson_status: open/, 'housekeeping must read the current lesson status field');
assert.doesNotMatch(skill, /(?:set|mark) `status: (?:open|triaged|applied|wont-fix)/, 'housekeeping must use lesson_status for triage outcomes');
assert.match(skill, /do not create new work/i, 'the audit must prevent duplicate work');
assert.doesNotMatch(skill, /scope: simple.*apply the fix directly/s, 'simple lessons cannot bypass RDC routing');
mustAppearInOrder(skill, [
  '### 1. Cluster',
  '### 2. Resolution audit',
  '### 3. Architectural report and interview gate',
  '### 4. Route only still-open, approved work through RDC',
  '### 5. Complete weekly lessons report',
], 'housekeeping workflow');
assert.match(skill, /complete work item/, 'routed work must have a complete work item');
assert.match(skill, /rdc:fixit/, 'housekeeping must route small work through fixit');
assert.match(skill, /rdc:fixit` creates and completes the sole work item/, 'fixit must own its single work item');
assert.match(skill, /rdc:plan` followed by `rdc:build/, 'housekeeping must route larger work through build');
assert.match(skill, /rdc:review/, 'each lesson action batch must be reviewed');
assert.match(skill, /dev deployment/, 'deployable work must record dev deployment evidence');
assert.match(skill, /question-and-answer list/, 'the weekly report must preserve architectural interview answers');

assert.match(guide, /lesson_status: open \| triaged \| applied \| wont-fix/, 'guide schema must match housekeeping');
mustAppearInOrder(guide, [
  'Resolution audit before routing',
  'Architectural report and interview',
  'RDC routing',
  'Run `rdc:review`',
], 'shared lessons guide');
assert.match(guide, /Do not create an `rdc:fixit`, `rdc:plan`, or `rdc:build` item before this audit/, 'guide must block premature routing');

console.log('housekeeping weekly lessons triage contract - PASS');
