import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSkill, getSkillBody, resolveSkillName, searchSkills } from '../lib/catalog.mjs';
import { toCloudBody } from '../lib/cloud-rewrite.mjs';

const names = ['outcome-exploration', 'design-comparison', 'troubleshooting', 'plan-critique', 'disagreement-resolution', 'work-handoff'];

test('convo resolves explicit invocation and ships complete templates in both caller variants', () => {
  for (const alias of ['convo', 'rdc:convo', '/rdc:convo']) assert.equal(resolveSkillName(alias), 'convo');
  assert.equal(resolveSkillName('convo/../../deploy'), null);
  const meta = getSkill('convo');
  assert.equal(meta.codeflow_required, false);
  assert.deepEqual(meta.produces, ['discussion_record', 'decision_record']);
  assert.ok(searchSkills('fair discussion').some(row => row.name === 'convo'));
  const source = readFileSync(new URL('../skills/convo/SKILL.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = getSkillBody('convo');
  assert.equal(body, source.replace(/^---\n[\s\S]*?\n---\n+/, ''));
  for (const rendered of [body, toCloudBody(body)]) {
    const templates = [...rendered.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]));
    assert.deepEqual(templates.map(t => t.template), names);
    for (const template of templates) {
      assert.ok(template.inputs.length >= 3, template.template);
      assert.ok(template.process.length >= 2, template.template);
      assert.ok(template.outputs.length >= 2, template.template);
      assert.ok(template.owner && template.dissent && template.handoff);
    }
    assert.match(rendered, /UNKNOWN/);
    assert.match(rendered, /DEFER/);
    assert.match(rendered, /RDC_TEST=1/);
    assert.match(rendered, /Silence is not agreement/);
    assert.match(rendered, /rdc:plan/);
    assert.match(rendered, /rdc:build/);
    assert.doesNotMatch(rendered, /127\.0\.0\.1:52437/);
  }
});
