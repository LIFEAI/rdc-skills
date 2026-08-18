#!/usr/bin/env node
/**
 * Regression guard: the plugin namespace is applied ONCE.
 *
 * `.claude-plugin/plugin.json` declares `"name": "rdc"`. Claude Code registers a
 * plugin component as `<plugin>:<declared frontmatter name>`. So any component
 * that ALSO spells the namespace into its own `name:` gets it twice, and the
 * menu renders `/rdc:rdc:plan` beside `/rdc:plan` — one entry per source.
 *
 * That defect was fixed for `commands/` in 643e198 ("the plugin namespace
 * already says rdc — stop saying it twice") and `skills/` was never migrated,
 * so 31 skills kept declaring `name: rdc:<x>` and two more carried the
 * namespace in their DIRECTORY name (`skills/rdc-brochurify/`), composing to
 * `rdc:rdc-brochurify`.
 *
 * Why the existing guards missed it: `tests/manifest-contract-fields.test.mjs`
 * and `tests/mcp.test.mjs` both assert `!/^rdc:rdc-/` against
 * `plugin.json.skills_meta[].slash` — a HAND-AUTHORED field that was already
 * spelled correctly (`rdc:brochurify`). Nothing asserted anything about the
 * frontmatter `name:` or the directory name, which is what the loader actually
 * composes from. This test checks the registering artifact, not the aspiration.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const PLUGIN = plugin.name;
assert.ok(PLUGIN, '.claude-plugin/plugin.json must declare a plugin name');

/** Declared `name:` from a markdown frontmatter block, or null when absent. */
function declaredName(file) {
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const block = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return null;
  const line = block[1].split('\n').find((l) => /^name:\s*/.test(l));
  return line ? line.replace(/^name:\s*/, '').trim().replace(/^["']|["']$/g, '') : null;
}

/** Every registering component: its file, the id it composes to, and its source. */
function components() {
  const out = [];

  const cmdDir = join(root, 'commands');
  if (existsSync(cmdDir)) {
    for (const f of readdirSync(cmdDir).filter((f) => f.endsWith('.md')).sort()) {
      const file = join(cmdDir, f);
      out.push({
        kind: 'command',
        file: `commands/${f}`,
        dir: f.replace(/\.md$/, ''),
        declared: declaredName(file),
      });
    }
  }

  const skillsDir = join(root, 'skills');
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'tests') continue;
    const file = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    out.push({
      kind: 'skill',
      file: `skills/${entry.name}/SKILL.md`,
      dir: entry.name,
      declared: declaredName(file),
    });
  }

  return out;
}

const all = components();
assert.ok(all.length > 0, 'expected at least one plugin component to check');

const offenders = { doublePrefixed: [], dirPrefixed: [] };

for (const c of all) {
  // The loader falls back to the directory / file stem when `name:` is absent.
  const effective = c.declared ?? c.dir;

  // 1. The declared name must not repeat the plugin namespace.
  //    `name: rdc:plan` under plugin `rdc` composes to `rdc:rdc:plan`.
  if (effective === PLUGIN || effective.startsWith(`${PLUGIN}:`)) {
    offenders.doublePrefixed.push(`${c.file}  name: ${effective}  ->  ${PLUGIN}:${effective}`);
  }

  // 2. Same defect, hyphen spelling: a directory named `rdc-brochurify`
  //    composes to `rdc:rdc-brochurify`.
  if (effective.startsWith(`${PLUGIN}-`)) {
    offenders.dirPrefixed.push(`${c.file}  name: ${effective}  ->  ${PLUGIN}:${effective}`);
  }
}

assert.deepEqual(
  offenders.doublePrefixed,
  [],
  `these components spell the "${PLUGIN}" namespace twice — the plugin supplies it:\n  ` +
    offenders.doublePrefixed.join('\n  '),
);

assert.deepEqual(
  offenders.dirPrefixed,
  [],
  `these components carry the "${PLUGIN}-" namespace in their own name — the plugin supplies it:\n  ` +
    offenders.dirPrefixed.join('\n  '),
);

// 3. No two components of the same kind may compose to the same registered id.
for (const kind of ['command', 'skill']) {
  const seen = new Map();
  for (const c of all.filter((c) => c.kind === kind)) {
    const id = `${PLUGIN}:${c.declared ?? c.dir}`;
    if (seen.has(id)) {
      assert.fail(`duplicate ${kind} registration ${id}: ${seen.get(id)} and ${c.file}`);
    }
    seen.set(id, c.file);
  }
}

console.log(`plugin namespace name tests — PASS (${all.length} components, namespace "${PLUGIN}")`);
