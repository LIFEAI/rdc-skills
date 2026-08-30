import assert from 'node:assert/strict';
import test from 'node:test';
import { getSkillBody } from '../lib/catalog.mjs';

const served = (name) => {
  const body = getSkillBody(name);
  assert.ok(body, `${name} must have a live catalog body`);
  return body;
};

test('live rdc_skill_get planning body makes Design Review explicit opt-in', () => {
  const plan = served('rdc:plan');
  assert.match(plan, /upsert_admitted_work_item/);
  assert.match(plan, /p_design_review := NULL/);
  assert.match(plan, /Dave explicitly requests Design Review/);
  assert.match(plan, /ordinary work reaches `rdc:review`/);
  assert.doesNotMatch(plan, /One task per work package via `insert_work_item/);
});

test('live rdc_skill_get build body routes work through CodeFlow admission and validator closure', () => {
  const build = served('rdc:build');
  assert.match(build, /runOrchestrator\(\)/);
  assert.match(build, /SupabaseStateStore/);
  assert.match(build, /admission_refocus/);
  assert.match(build, /pipeline_complete/);
  assert.match(build, /durably `done`/);
});

test('live rdc_skill_get overnight body cannot map CLEAN directly to an incomplete epic', () => {
  const overnight = served('rdc:overnight');
  assert.match(overnight, /only when its receipt is `pipeline_complete`/i);
  assert.match(overnight, /validator-closed/);
  assert.doesNotMatch(overnight, /"CLEAN"`: mark epic `done` in work_items, push, continue to next epic/);
});
