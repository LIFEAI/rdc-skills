import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const release = readFileSync(join(root, 'RELEASE.md'), 'utf8');

assert.match(release, /npm version patch --no-git-tag-version/);
assert.match(release, /npm view @lifeaitools\/rdc-skills@<version> version/);
assert.match(release, /npm pack @lifeaitools\/rdc-skills@<version>/);
assert.match(release, /npm install -g @lifeaitools\/rdc-skills@<version>/);
assert.match(release, /rdc-skills-install --profile lifeai/);

console.log('release contract test passed');
