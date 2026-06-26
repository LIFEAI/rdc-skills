/**
 * lib/catalog.mjs — rdc-skills catalog loader for the local MCP server.
 *
 * Source of truth: `.claude-plugin/plugin.json` → `skills_meta` (an object keyed
 * by skill name). Each entry provides { name, slash, category, usage, args,
 * requires, triggers, ... }. We enrich each entry with the `description` from
 * the skill's own `skills/<name>/SKILL.md` frontmatter (the human summary).
 *
 * Loading is LIVE: the catalog is re-read from disk when older than CACHE_TTL_MS
 * so a skill edit (frontmatter or body) is picked up without a server restart.
 * Published packages must have one `skills_meta` entry for every skill
 * directory. The frontmatter-only path below is a local-dev resilience fallback
 * so an incomplete checkout does not silently hide a skill while it is being
 * repaired; tests enforce that released packages do not rely on it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_JSON = path.join(REPO_ROOT, '.claude-plugin', 'plugin.json');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');

const CACHE_TTL_MS = 5000; // short TTL: live-from-disk feel, cheap re-reads

let _cache = null;
let _cacheAt = 0;

/** Read + parse the YAML frontmatter block of a SKILL.md. Returns {} on miss. */
function readFrontmatter(skillMdPath) {
  try {
    const raw = fs.readFileSync(skillMdPath, 'utf8').replace(/\r\n/g, '\n');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const parsed = YAML.parse(m[1]);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Map a raw skills_meta entry + SKILL.md frontmatter into a compact catalog row. */
function toCatalogEntry(name, meta, frontmatter) {
  const fm = frontmatter || {};
  const description = fm.description || meta.description || '';
  // triggers/usage/slash/etc. should live in skills_meta for published packages.
  // Frontmatter fallback keeps incomplete local checkouts searchable during repair.
  const metaTriggers = Array.isArray(meta.triggers) && meta.triggers.length ? meta.triggers : null;
  const fmTriggers = Array.isArray(fm.triggers) ? fm.triggers : [];
  const slash = meta.slash || fm.slash || `rdc:${name}`;
  const aliases = [name, slash];
  if (slash.startsWith('rdc:')) aliases.push(`/${slash}`);
  return {
    name,
    slash,
    aliases,
    category: meta.category || fm.category || 'tooling',
    summary: description,
    when_to_use: metaTriggers || fmTriggers,
    // usage falls back to the slash form so every skill carries an invocation hint.
    usage: meta.usage || fm.usage || slash,
    args: meta.args || fm.args || { positional: [], flags: [] },
    requires: Array.isArray(meta.requires) ? meta.requires
            : Array.isArray(fm.requires) ? fm.requires : [],
    produces: Array.isArray(meta.produces) ? meta.produces
             : Array.isArray(fm.produces) ? fm.produces : [],
    follows: Array.isArray(meta.follows) ? meta.follows
            : Array.isArray(fm.follows) ? fm.follows : [],
    leads_to: Array.isArray(meta.leads_to) ? meta.leads_to
              : Array.isArray(fm.leads_to) ? fm.leads_to : [],
    default_model: meta.default_model || fm.default_model || 'inherit',
    sandbox_aware: Boolean(meta.sandbox_aware ?? fm.sandbox_aware ?? false),
    output_contract: meta.output_contract || fm.output_contract || null,
    enabled_default: Boolean(meta.enabled_default ?? fm.enabled_default ?? true),
    codeflow_required: Boolean(meta.codeflow_required ?? fm.codeflow_required ?? false),
    variants: ['cli', 'cloud'],
  };
}

/** Re-read plugin.json + skill frontmatter from disk and rebuild the catalog. */
function buildCatalog() {
  let plugin = {};
  try {
    plugin = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
  } catch {
    plugin = {};
  }
  const skillsMeta = plugin.skills_meta && typeof plugin.skills_meta === 'object' ? plugin.skills_meta : {};

  const byName = new Map();

  // 1. Every skills_meta entry → enrich with its SKILL.md frontmatter.
  for (const [name, meta] of Object.entries(skillsMeta)) {
    const skillMd = path.join(SKILLS_DIR, name, 'SKILL.md');
    const fm = fs.existsSync(skillMd) ? readFrontmatter(skillMd) : {};
    byName.set(name, toCatalogEntry(name, meta || {}, fm));
  }

  // 2. Local-dev fallback: a skill dir with SKILL.md but no meta entry.
  if (fs.existsSync(SKILLS_DIR)) {
    for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || byName.has(entry.name)) continue;
      const skillMd = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      const fm = readFrontmatter(skillMd);
      byName.set(entry.name, toCatalogEntry(entry.name, {}, fm));
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Return the cached catalog, rebuilding if the TTL has elapsed. */
function getCatalog() {
  const now = Date.now();
  if (!_cache || now - _cacheAt > CACHE_TTL_MS) {
    _cache = buildCatalog();
    _cacheAt = now;
  }
  return _cache;
}

/** Compact catalog for `rdc_skill_list`. */
export function listSkills() {
  return getCatalog();
}

/** Full catalog row for one skill, or null if unknown. */
export function getSkill(name) {
  const resolved = resolveSkillName(name);
  return resolved ? getCatalog().find((s) => s.name === resolved) || null : null;
}

/** List of valid skill names (for error messages). */
export function skillNames() {
  return getCatalog().map((s) => s.name);
}

/** Return the canonical skill directory name for a bare name, slash, or usage token. */
export function resolveSkillName(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const token = raw.split(/\s+/)[0];
  const catalog = getCatalog();
  const direct = catalog.find((s) => s.name === token || s.slash === token);
  if (direct) return direct.name;
  if (token.startsWith('/')) {
    const withoutSlash = token.slice(1);
    const slashMatch = catalog.find((s) => s.slash === withoutSlash);
    if (slashMatch) return slashMatch.name;
  }
  if (token.startsWith('rdc:')) {
    const bare = token.slice(4);
    const bareMatch = catalog.find((s) => s.name === bare || s.name === `rdc-${bare}`);
    if (bareMatch) return bareMatch.name;
  }
  return null;
}

/**
 * Read the raw SKILL.md body (frontmatter stripped) for a skill, live from disk.
 * Returns null if the file does not exist.
 */
export function getSkillBody(name) {
  const resolved = resolveSkillName(name);
  if (!resolved) return null;
  const skillMd = path.join(SKILLS_DIR, resolved, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return null;
  const raw = fs.readFileSync(skillMd, 'utf8').replace(/\r\n/g, '\n');
  // Strip the leading frontmatter block if present.
  const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? raw.slice(m[0].length).replace(/^\n+/, '') : raw;
}

/** Absolute path to a hand-tuned cloud override, or null if absent. */
export function cloudOverridePath(name) {
  const resolved = resolveSkillName(name);
  if (!resolved) return null;
  const p = path.join(SKILLS_DIR, resolved, 'SKILL.cloud.md');
  return fs.existsSync(p) ? p : null;
}

/** Read the hand-tuned cloud override body (frontmatter stripped), or null. */
export function getCloudOverride(name) {
  const p = cloudOverridePath(name);
  if (!p) return null;
  const raw = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? raw.slice(m[0].length).replace(/^\n+/, '') : raw;
}

/**
 * Fuzzy/substring search over name + slash + summary + triggers.
 * Returns ranked rows with enough metadata for raw MCP/curl callers to choose
 * and fetch a skill without a second catalog lookup. score: higher = better.
 */
export function searchSkills(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const results = [];
  for (const s of getCatalog()) {
    const hay = {
      name: s.name.toLowerCase(),
      slash: (s.slash || '').toLowerCase(),
      summary: (s.summary || '').toLowerCase(),
      triggers: (s.when_to_use || []).join(' ').toLowerCase(),
    };
    let score = 0;
    for (const term of terms) {
      if (hay.name === term) score += 100;
      else if (hay.name.includes(term)) score += 40;
      if (hay.slash.includes(term)) score += 20;
      if (hay.triggers.includes(term)) score += 12;
      if (hay.summary.includes(term)) score += 6;
    }
    if (score > 0) {
      results.push({
        name: s.name,
        slash: s.slash,
        aliases: s.aliases,
        category: s.category,
        summary: s.summary,
        usage: s.usage,
        requires: s.requires,
        codeflow_required: s.codeflow_required,
        variants: s.variants,
        score,
      });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}
