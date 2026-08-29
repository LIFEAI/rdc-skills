#!/usr/bin/env node
/**
 * Generate every skill/command `description` from ONE source: plugin.json's
 * `skills_meta`.
 *
 * WHY THIS EXISTS
 *
 * `/rdc:plan` appeared FOUR times in the command list with THREE different
 * descriptions. Measured 2026-08-29:
 *
 *   marketplaces/rdc-skills/commands/plan.md          (179 lines)
 *   marketplaces/rdc-skills/skills/plan/SKILL.md      (368 lines)
 *   cache/rdc-skills/.../latest/commands/plan.md
 *   cache/rdc-skills/.../latest/skills/plan/SKILL.md
 *
 * Two install locations (Claude Code's own plugin mechanism — marketplace is
 * the source, cache is the installed copy) multiplied by two surfaces we ship
 * ourselves. Nineteen verbs are shipped as BOTH a command and a skill, each
 * with its own hand-written frontmatter, so the descriptions drifted apart.
 *
 * The duplicate SURFACES are a separate question with real content at stake.
 * The duplicate DESCRIPTIONS are not: they are two hand-written copies of one
 * fact. `skills_meta` already carries `slash`, `usage`, typed positional args
 * and typed flags — everything needed to render the line. It just was not what
 * rendered.
 *
 * THE SHAPE, per operator instruction 2026-08-29:
 *
 *     rdc:build (epic-id) - [--no-review] — execute a planned epic
 *     rdc:deploy (slug, [action]) - [--fix, --hotfix] — ship to PM2 dev
 *
 * Required positionals bare, optional in brackets, flags after the dash. No
 * paragraph. The long explanation belongs in the body, which is where someone
 * who has already chosen the command is reading.
 *
 * `purpose` is authored in skills_meta. On first run this backfills it from the
 * existing description so nothing is invented, then the render is deterministic
 * forever after: change the meta, re-run, both surfaces agree.
 *
 * Run: node scripts/gen-skill-descriptions.mjs [--check]
 *   --check  exit 1 if any file is out of date (for CI / the acceptance gate)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, '.claude-plugin', 'plugin.json');
const CHECK = process.argv.includes('--check');

/** Render the one-line description for a skill from its meta. */
export function renderDescription(meta) {
  const slash = meta.slash || meta.name;
  const positional = meta.args?.positional;
  let head;
  if (positional) {
    const pos = positional.map((a) => (a.required ? a.name : `[${a.name}]`)).join(', ');
    const flags = (meta.args?.flags ?? []).map((f) => f.name).join(', ');
    head = `${slash} (${pos})${flags ? ` - [${flags}]` : ''}`;
  } else {
    // Command-only verbs have no typed arg table. Their `usage` string is the
    // authored truth, so render its tail verbatim rather than inventing a typed
    // signature — `rdc:mode ()` would be a confident lie about a verb that
    // takes three forms.
    const tail = String(meta.usage || '').replace(new RegExp(`^\\s*${slash}\\s*`), '').trim();
    head = tail ? `${slash} ${tail}` : slash;
  }
  return meta.purpose ? `${head} — ${meta.purpose}` : head;
}

/**
 * Best-effort one-line purpose from an existing verbose description.
 *
 * Only used to BACKFILL skills_meta once. Everything here is already-authored
 * text being shortened — nothing is invented, because a generated description
 * that states a capability nobody wrote is exactly the failure mode this repo
 * spends its gates preventing.
 */
export function purposeFrom(description) {
  let d = String(description || '').replace(/\s+/g, ' ').trim();
  d = d.replace(/^Usage\s+`[^`]*`\s*[—-]\s*/i, '');   // drop a leading "Usage `x` —"
  d = d.replace(/^`[^`]*`\s*[—-]\s*/, '');
  d = d.replace(/^rdc:[a-z-]+\s*[—-]\s*/i, '');
  const stop = d.search(/(?<=\.)\s+(?:Use|Called|Produces|Then|After|This)\b/);
  if (stop > 0) d = d.slice(0, stop);
  d = d.split(/\.\s/)[0].replace(/\.$/, '').trim();
  if (d.length <= 110) return d;
  // Cut at a word boundary. Slicing mid-word produced "...bearer-authe..." —
  // a truncation that reads as a typo rather than as an elision.
  const cut = d.slice(0, 107);
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}...`;
}

/** Replace the frontmatter `description:` of a markdown file. Returns true if changed. */
function setDescription(file, description) {
  const src = readFileSync(file, 'utf8');
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return { changed: false, reason: 'no frontmatter' };
  const body = fm[1];
  // description: may be plain, quoted, or a >- folded block spanning lines.
  const stripped = body.replace(/^description:\s*(?:>-?\s*\n(?:[ \t]+.*\n?)*|.*\n?)/m, '');
  const rebuilt = `${stripped.replace(/\n+$/, '')}\ndescription: ${JSON.stringify(description)}`;
  const out = src.replace(fm[0], `---\n${rebuilt}\n---`);
  if (out === src) return { changed: false };
  if (!CHECK) writeFileSync(file, out);
  return { changed: true };
}

const plugin = JSON.parse(readFileSync(PLUGIN, 'utf8'));
const meta = plugin.skills_meta;

/**
 * Command-only verbs live in their OWN block, not in skills_meta.
 *
 * A first cut backfilled them straight into skills_meta and broke its
 * invariant: `skills_meta` means "one entry per skill directory", asserted at
 * 43, and adding thirteen commands made it 56. The acceptance suite caught it.
 *
 * That invariant is worth keeping — skills_meta feeds skill dispatch, and a
 * command with no skill directory behind it would be a dangling entry. So the
 * commands get a sibling block, and the generator reads both. One source of
 * truth per surface, rather than one source of truth with a hole in it.
 *
 * Backfilled from each command's own authored `usage` line, so an entry only
 * ever restates what the file already stated.
 */
plugin.commands_meta = plugin.commands_meta || {};
const cmdMeta = plugin.commands_meta;
for (const f of readdirSync(path.join(ROOT, 'commands')).filter((x) => x.endsWith('.md'))) {
  const name = f.replace(/\.md$/, '');
  if (meta[name] || cmdMeta[name]) continue;
  const src = readFileSync(path.join(ROOT, 'commands', f), 'utf8');
  const fm = src.match(/description:\s*(?:>-?\s*\n((?:[ \t]+.*\n?)*)|["']?(.*?)["']?\s*\n)/);
  const raw = (fm?.[1] || fm?.[2] || '').replace(/\s+/g, ' ').trim();
  const usage = raw.match(/Usage\s+`([^`]+)`/i)?.[1]?.trim() || `rdc:${name}`;
  cmdMeta[name] = { name, slash: `rdc:${name}`, usage, purpose: purposeFrom(raw) };
}

const names = [...Object.keys(meta), ...Object.keys(cmdMeta)].filter((k) => !k.startsWith('$'));
const metaFor = (name) => meta[name] || cmdMeta[name];

let backfilled = 0;
let touched = 0;
const stale = [];

for (const name of names) {
  const m = metaFor(name);
  const skillFile = path.join(ROOT, 'skills', name, 'SKILL.md');
  const cmdFile = path.join(ROOT, 'commands', `${name}.md`);

  if (!m.purpose) {
    const source = existsSync(skillFile) ? skillFile : (existsSync(cmdFile) ? cmdFile : null);
    if (source) {
      const fm = readFileSync(source, 'utf8').match(/description:\s*(?:>-?\s*\n((?:[ \t]+.*\n?)*)|["']?(.*?)["']?\s*\n)/);
      const raw = (fm?.[1] || fm?.[2] || '').replace(/\s+/g, ' ').trim();
      const p = purposeFrom(raw);
      if (p) { m.purpose = p; backfilled++; }
    }
  }

  const description = renderDescription(m);
  for (const f of [skillFile, cmdFile]) {
    if (!existsSync(f)) continue;
    const r = setDescription(f, description);
    if (r.changed) { touched++; stale.push(path.relative(ROOT, f)); }
  }
}

if (backfilled && !CHECK) writeFileSync(PLUGIN, `${JSON.stringify(plugin, null, 2)}\n`);

if (CHECK) {
  if (stale.length) {
    console.error(`descriptions out of date (${stale.length}) — run: node scripts/gen-skill-descriptions.mjs`);
    for (const f of stale.slice(0, 20)) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`descriptions current across ${names.length} skills`);
  process.exit(0);
}

console.log(`skills_meta: ${names.length} skills, ${backfilled} purpose(s) backfilled`);
console.log(`descriptions rewritten: ${touched} file(s)`);
