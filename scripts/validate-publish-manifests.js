#!/usr/bin/env node
/**
 * validate-publish-manifests.js
 * WP-6: PUBLISH.md convention validator for rdc-skills
 *
 * Queries app_deployments (active rows), checks PUBLISH.md presence + schema
 * for each registered deployable target.
 *
 * 2026-07-05: DEPLOY-block enforcement (Approved: Dave, port-from-registry).
 *   - Every deployable MUST carry a valid <!-- DEPLOY --> block (hard FAIL if absent).
 *   - `port` MUST be the literal `registry` — a hardcoded integer is a FAIL.
 *   - `port: registry` MUST resolve: if the app has a PM2 dev row, it MUST have pm2_port.
 *   - slug→dir resolves via apps.monorepo_path (fixes slug≠dir apps like zoen, rapha).
 *
 * Usage:
 *   node scripts/validate-publish-manifests.js [--mode warn|fail] [--slug <name>] [--json] [--strict]
 *
 * Exit codes:
 *   0 — all checks passed (or warn mode with only warnings)
 *   1 — one or more FAIL lines (hard error)
 *   2 — invocation error (bad args)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let mode = 'warn';       // warn | fail
let slugFilter = null;   // --slug <name>
let jsonOutput = false;  // --json
let strict = false;      // --strict (same as --mode fail)

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--mode') {
    const v = args[++i];
    if (v !== 'warn' && v !== 'fail') {
      console.error('ERROR: --mode must be warn or fail');
      process.exit(2);
    }
    mode = v;
  } else if (a === '--slug') {
    slugFilter = args[++i];
    if (!slugFilter) {
      console.error('ERROR: --slug requires a value');
      process.exit(2);
    }
  } else if (a === '--json') {
    jsonOutput = true;
  } else if (a === '--strict') {
    strict = true;
    mode = 'fail';
  } else {
    console.error(`ERROR: unknown argument: ${a}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONOREPO_ROOT = 'C:/Dev/regen-root';
const CLAUTH_BASE = 'http://127.0.0.1:52437';

// Ordered list of root-relative prefixes to probe when looking for app source
const MONOREPO_SEARCH_DIRS = ['apps', 'sites', 'models', 'mcp-servers', 'packages'];

const REQUIRED_FRONTMATTER_FIELDS = ['schema_version', 'entity_slug', 'artifact_type', 'environments', 'status'];
const ALLOWED_ARTIFACT_TYPES = ['website', 'api', 'package', 'worker', 'mcp-server'];
const ALLOWED_STATUSES = ['active', 'draft', 'deprecated'];
const ALLOWED_ENVIRONMENTS = ['dev', 'prod'];
const ALLOWED_SCHEMA_VERSIONS = ['1.0'];

// Supabase project and REST base
const SUPABASE_PROJECT_HOST = 'uvojezuorjgqzmhhgluu.supabase.co';

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

const results = [];
let hasHardFail = false;

// Populated in main() from the registry (apps + app_deployments).
const dirBySlug = new Map();   // slug -> monorepo_path (root-relative)
const rowsBySlug = new Map();  // slug -> [app_deployments rows]

function emit(level, slug, message, detail) {
  const entry = { level, slug, message, detail: detail || null };
  results.push(entry);
  if (level === 'FAIL') hasHardFail = true;
  if (!jsonOutput) {
    const prefix = level === 'FAIL' ? '✗ FAIL' : level === 'WARN' ? '⚠ WARN' : '✓ PASS';
    console.log(`${prefix} [${slug}] ${message}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Fetch plain text from clauth daemon (never prints value) */
function fetchClauth(service) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${CLAUTH_BASE}/v/${service}`, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`clauth /v/${service} → HTTP ${res.statusCode}`));
        } else {
          resolve(buf.trim());
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('clauth timeout')); });
  });
}

/** REST GET against Supabase with anon key */
function supabaseGet(anonKey, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_PROJECT_HOST,
      path,
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Supabase REST ${path} → HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        } else {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Supabase timeout')); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal — no external dep required)
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a PUBLISH.md string.
 * Only handles scalar values, arrays on same line ([a, b, c]), and quoted strings.
 * Returns null if no frontmatter delimiters found.
 */
function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const yaml = fmMatch[1];
  const result = {};

  for (const line of yaml.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1];
    let value = kv[2].trim();

    // Array: [a, b, c] or [a] or []
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner ? inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')) : [];
      continue;
    }

    // Quoted string
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * Extract surface section IDs from PUBLISH.md content.
 * Looks for <!-- SURFACE:<id> --> markers.
 */
function parseSurfaceIds(content) {
  const ids = [];
  const re = /<!--\s*SURFACE:([a-zA-Z0-9_-]+)\s*-->/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

/**
 * Extract watch_paths from a named surface section.
 * Returns array of watch_path strings (may be empty).
 */
function parseSurfaceWatchPaths(content, surfaceId) {
  const re = new RegExp(`<!--\\s*SURFACE:${surfaceId}\\s*-->[\\s\\S]*?<!--\\s*/SURFACE:${surfaceId}\\s*-->`, 'i');
  const section = content.match(re);
  if (!section) return [];

  const block = section[0];
  const watchPathsMatch = block.match(/watch_paths:\s*\r?\n((?:\s+-\s+.+\r?\n?)*)/);
  if (!watchPathsMatch) return [];

  return watchPathsMatch[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s+-\s+/, '').trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Derive the local filesystem path where we'd expect PUBLISH.md for a given app_slug.
 * Probes MONOREPO_SEARCH_DIRS in order, returning the first hit.
 * Returns null if no directory found (standalone or unknown).
 */
function resolveAppRoot(slug) {
  // Authoritative: apps.monorepo_path (fixes slug≠dir apps like zoen→apps/zoen-web).
  const dir = dirBySlug.get(slug);
  if (dir) {
    const candidate = path.join(MONOREPO_ROOT, dir);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fallback: probe by slug name.
  for (const d of MONOREPO_SEARCH_DIRS) {
    const candidate = path.join(MONOREPO_ROOT, d, slug);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation logic for a single app row
// ---------------------------------------------------------------------------

function validateApp(slug) {
  const appRoot = resolveAppRoot(slug);

  if (!appRoot) {
    // Could be standalone repo — skip with note in v1
    emit('WARN', slug, 'app root not found in monorepo — may be standalone repo, skipping (v1 scope)');
    return null;
  }

  const publishPath = path.join(appRoot, 'PUBLISH.md');

  if (!fs.existsSync(publishPath)) {
    if (mode === 'fail') {
      emit('FAIL', slug, 'PUBLISH.md missing', publishPath);
    } else {
      emit('WARN', slug, 'PUBLISH.md missing', publishPath);
    }
    return null;
  }

  // File exists — parse and validate
  const content = fs.readFileSync(publishPath, 'utf8');
  const fm = parseFrontmatter(content);

  if (!fm) {
    emit('FAIL', slug, 'PUBLISH.md has no YAML frontmatter (missing --- delimiters)', publishPath);
    return null;
  }

  let ok = true;

  // Check required fields
  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    if (fm[field] === undefined || fm[field] === null || fm[field] === '') {
      emit('FAIL', slug, `PUBLISH.md missing required field: ${field}`, publishPath);
      ok = false;
    }
  }

  // schema_version
  if (fm.schema_version && !ALLOWED_SCHEMA_VERSIONS.includes(fm.schema_version)) {
    emit('FAIL', slug, `PUBLISH.md schema_version "${fm.schema_version}" not in allowed set: ${ALLOWED_SCHEMA_VERSIONS.join(', ')}`, publishPath);
    ok = false;
  }

  // artifact_type
  if (fm.artifact_type && !ALLOWED_ARTIFACT_TYPES.includes(fm.artifact_type)) {
    emit('FAIL', slug, `PUBLISH.md artifact_type "${fm.artifact_type}" not in allowed set: ${ALLOWED_ARTIFACT_TYPES.join(', ')}`, publishPath);
    ok = false;
  }

  // status
  if (fm.status && !ALLOWED_STATUSES.includes(fm.status)) {
    emit('FAIL', slug, `PUBLISH.md status "${fm.status}" not in allowed set: ${ALLOWED_STATUSES.join(', ')}`, publishPath);
    ok = false;
  }

  // environments — must be array, at least one, each in allowed set
  if (fm.environments !== undefined) {
    if (!Array.isArray(fm.environments) || fm.environments.length === 0) {
      emit('FAIL', slug, 'PUBLISH.md environments must be a non-empty array', publishPath);
      ok = false;
    } else {
      for (const env of fm.environments) {
        if (!ALLOWED_ENVIRONMENTS.includes(env)) {
          emit('FAIL', slug, `PUBLISH.md environments contains unknown value: "${env}"`, publishPath);
          ok = false;
        }
      }
    }
  }

  // Surface sections — at least one required
  const surfaceIds = parseSurfaceIds(content);
  if (surfaceIds.length === 0) {
    emit('FAIL', slug, 'PUBLISH.md has no <!-- SURFACE:<id> --> sections', publishPath);
    ok = false;
  } else {
    // Each surface must have watch_paths
    for (const sid of surfaceIds) {
      const wp = parseSurfaceWatchPaths(content, sid);
      if (wp.length === 0) {
        emit('FAIL', slug, `PUBLISH.md surface "${sid}" has no watch_paths entries`, publishPath);
        ok = false;
      }
    }
  }

  // DEPLOY block — mandatory as of 2026-07-05. Always a hard FAIL (not mode-gated).
  if (!validateDeployBlock(slug, content, publishPath)) ok = false;

  if (ok) {
    emit('PASS', slug, 'PUBLISH.md valid', `${surfaceIds.length} surface(s): ${surfaceIds.join(', ')}`);
  }

  return { fm, surfaceIds, publishPath };
}

/**
 * Validate the <!-- DEPLOY --> block. Returns true iff valid.
 * Contract: .claude/rules/app-deploy-manifest.md (port-from-registry, Approved 2026-07-05).
 */
function validateDeployBlock(slug, content, publishPath) {
  const m = content.match(/<!-- DEPLOY -->([\s\S]*?)<!-- \/DEPLOY -->/);
  if (!m) {
    emit('FAIL', slug, 'PUBLISH.md has no <!-- DEPLOY --> block (mandatory)', publishPath);
    return false;
  }
  const body = m[1];
  let ok = true;

  for (const field of ['runtime', 'port', 'health_path']) {
    if (!new RegExp(`^${field}:`, 'm').test(body)) {
      emit('FAIL', slug, `DEPLOY block missing required field: ${field}`, publishPath);
      ok = false;
    }
  }

  const portLine = body.match(/^port:\s*([^\s#]+)/m);
  if (portLine) {
    const val = portLine[1].trim();
    if (!/^registry$/i.test(val)) {
      emit('FAIL', slug, `DEPLOY block port must be the literal 'registry', not '${val}' (port lives in app_deployments.pm2_port)`, publishPath);
      ok = false;
    } else {
      // Resolvability: an app WITH a PM2 dev row must have a pm2_port.
      const rows = rowsBySlug.get(slug) || [];
      const pm2 = rows.find((r) => r.host_type === 'pm2' && r.environment === 'dev');
      if (pm2 && !pm2.pm2_port) {
        emit('FAIL', slug, "DEPLOY block port: registry but the PM2 dev row has no pm2_port to resolve", publishPath);
        ok = false;
      }
    }
  }

  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!jsonOutput) {
    console.log(`\nvalidate-publish-manifests — mode=${mode}${slugFilter ? ` slug=${slugFilter}` : ''}\n`);
  }

  // 1. Get Supabase anon key from clauth
  let anonKey;
  try {
    anonKey = await fetchClauth('supabase-anon');
  } catch (err) {
    console.error(`ERROR: cannot reach clauth daemon — ${err.message}`);
    console.error('Fix: ensure clauth daemon is running at http://127.0.0.1:52437');
    process.exit(1);
  }

  // 2. Query app_deployments for active rows (include host_type + pm2_port for
  //    port: registry resolvability).
  let rows;
  try {
    let qpath = '/rest/v1/app_deployments?status=eq.active&select=app_slug,environment,url,host_type,pm2_port&order=app_slug.asc';
    if (slugFilter) {
      qpath += `&app_slug=eq.${encodeURIComponent(slugFilter)}`;
    }
    rows = await supabaseGet(anonKey, qpath);
  } catch (err) {
    console.error(`ERROR: Supabase query failed — ${err.message}`);
    process.exit(1);
  }

  // 2b. Query apps for monorepo_path (authoritative slug→dir; fixes slug≠dir).
  try {
    const apps = await supabaseGet(anonKey, '/rest/v1/apps?select=slug,monorepo_path');
    for (const a of apps) {
      if (a.monorepo_path) dirBySlug.set(a.slug, a.monorepo_path);
    }
  } catch (err) {
    // Non-fatal: fall back to slug-name probing in resolveAppRoot.
    if (!jsonOutput) console.log(`(note: apps monorepo_path lookup failed — ${err.message}; using slug-name fallback)`);
  }

  // Index all deployment rows by slug for port resolvability checks.
  for (const r of rows) {
    if (!rowsBySlug.has(r.app_slug)) rowsBySlug.set(r.app_slug, []);
    rowsBySlug.get(r.app_slug).push(r);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    if (!jsonOutput) {
      console.log(slugFilter ? `No active app_deployments row found for slug: ${slugFilter}` : 'No active app_deployments rows found.');
    }
    process.exit(0);
  }

  // Deduplicate slugs (same app_slug may have dev + prod rows)
  const slugsSeen = new Set();
  const uniqueRows = rows.filter((r) => {
    if (slugsSeen.has(r.app_slug)) return false;
    slugsSeen.add(r.app_slug);
    return true;
  });

  if (!jsonOutput) {
    console.log(`Checking ${uniqueRows.length} unique app slug(s) from ${rows.length} active app_deployments row(s)...\n`);
  }

  // 3. Validate each slug
  for (const row of uniqueRows) {
    validateApp(row.app_slug);
  }

  // 4. Summary
  const passCount = results.filter((r) => r.level === 'PASS').length;
  const warnCount = results.filter((r) => r.level === 'WARN').length;
  const failCount = results.filter((r) => r.level === 'FAIL').length;

  if (jsonOutput) {
    console.log(JSON.stringify({ mode, results, summary: { pass: passCount, warn: warnCount, fail: failCount } }, null, 2));
  } else {
    console.log(`\nSummary: ${passCount} PASS · ${warnCount} WARN · ${failCount} FAIL`);
    if (hasHardFail) {
      console.log('Result: FAIL\n');
    } else {
      console.log(warnCount > 0 ? 'Result: WARN (exit 0 in warn mode)\n' : 'Result: PASS\n');
    }
  }

  process.exit(hasHardFail ? 1 : 0);
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
