import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const captureSkills = ['build', 'deploy', 'overnight', 'fixit', 'plan', 'preplan', 'review', 'release', 'collab'];

for (const skill of captureSkills) {
  const text = readFileSync(join(root, 'skills', skill, 'SKILL.md'), 'utf8');
  assert.match(text, /lesson_status: open/, `${skill} must capture the canonical status key`);
  assert.doesNotMatch(text, /and `status` \(`open`/, `${skill} must not emit the legacy status key`);
}

const guide = readFileSync(join(root, 'guides', 'lessons-learned-spec.md'), 'utf8');
assert.match(guide, /Legacy status migration/);
assert.match(guide, /`status` and no `lesson_status`/);

const housekeeping = readFileSync(join(root, 'skills', 'housekeeping', 'SKILL.md'), 'utf8');
assert.match(housekeeping, /When invoked with `--lessons`, skip every non-lessons maintenance section/);
assert.match(housekeeping, /including Directory Structure Verification/);
const legacyNormalization = housekeeping.indexOf('normalize every legacy lesson that has `status` but no `lesson_status`');
const openFilter = housekeeping.indexOf('Then read all `.rdc/lessons/*.md` with `lesson_status: open`');
assert.ok(legacyNormalization >= 0 && openFilter > legacyNormalization, 'legacy lessons must be normalized before the open-status filter');

console.log('lessons pipeline contract test passed');
