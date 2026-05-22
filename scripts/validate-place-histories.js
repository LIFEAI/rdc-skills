#!/usr/bin/env node
/**
 * validate-place-histories.js
 * HISTORY.md convention validator for Place Fund real-estate / conservation projects.
 *
 * Queries prt_projects with the trigger predicate, checks places/<slug>/HISTORY.md
 * presence and schema validity for each qualifying row.
 *
 * Usage:
 *   node scripts/validate-place-histories.js [--mode warn|fail] [--slug <name>] [--json]
 *
 * Exit codes:
 *   0 — all checks passed (or warn mode with only warnings)
 *   1 — one or more FAIL lines (hard error)
 *   2 — invocation error (bad args)
 *
 * Trigger predicate:
 *   project_type IN ('ranch','eco-hospitality','mixed','conservation',
 *                    'regenerative-agriculture','real-estate','development')
 *   AND name IS NOT NULL
 *   AND (location_state IS NOT NULL OR location_city IS NOT NULL OR country IS NOT NULL
 *        OR total_acres IS NOT NULL OR lat IS NOT NULL
 *        OR EXISTS (SELECT 1 FROM geo_projects WHERE prt_project_id = prt_projects.id))
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
const SUPABASE_PROJECT_HOST = 'uvojezuorjgqzmhhgluu.supabase.co';

// project_types that trigger HISTORY.md requirement
const TRIGGERING_PROJECT_TYPES = new Set([
  'ranch',
  'eco-hospitality',
  'mixed',
  'conservation',
  'regenerative-agriculture',
  'real-estate',
  'development',
]);

// Required frontmatter fields in HISTORY.md
const REQUIRED_FRONTMATTER_FIELDS = [
  'schema_version',
  'prt_slug',
  'project_type',
  'location',
  'steward',
  'research_status',
  'last_reviewed',
  'contributors',
];

const ALLOWED_SCHEMA_VERSIONS = ['1.0'];

const ALLOWED_RESEARCH_STATUSES = ['draft', 'in-research', 'peer-reviewed', 'published'];

// Required body section headings (## heading, exact text)
const REQUIRED_SECTIONS = [
  '## Land lineage',
  '## Stewardship transitions',
  '## Ecological context',
  '## Cultural significance',
  '## Regulatory record',
];

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

const results = [];
let hasHardFail = false;

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
function supabaseGet(anonKey, qpath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_PROJECT_HOST,
      path: qpath,
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
          reject(new Error(`Supabase REST ${qpath} → HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
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
// YAML frontmatter parser (minimal — no external dep)
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a HISTORY.md string.
 * Handles scalars, inline arrays ([a, b]), quoted strings, and nested objects
 * (single-level indent under a key: followed by child key: value lines).
 * Returns null if no frontmatter delimiters found.
 */
function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const yaml = fmMatch[1];
  const result = {};
  const lines = yaml.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Top-level key
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!kv) { i++; continue; }

    const key = kv[1];
    let value = kv[2].trim();

    // Inline array: [a, b, c] or []
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner ? inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')) : [];
      i++;
      continue;
    }

    // Quoted string
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
      i++;
      continue;
    }

    // Empty value — may be start of nested object
    if (value === '') {
      // Peek ahead for indented child lines
      const nested = {};
      let j = i + 1;
      while (j < lines.length) {
        const child = lines[j].match(/^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
        if (!child) break;
        let cv = child[2].trim();
        if ((cv.startsWith('"') && cv.endsWith('"')) ||
            (cv.startsWith("'") && cv.endsWith("'"))) {
          cv = cv.slice(1, -1);
        }
        // Inline array under nested key
        if (cv.startsWith('[') && cv.endsWith(']')) {
          const inner2 = cv.slice(1, -1).trim();
          nested[child[1]] = inner2 ? inner2.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')) : [];
        } else {
          nested[child[1]] = cv;
        }
        j++;
      }
      if (j > i + 1) {
        result[key] = nested;
        i = j;
      } else {
        result[key] = value;
        i++;
      }
      continue;
    }

    result[key] = value;
    i++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Slug → filesystem directory name
// Preserves DB slug but lowercases for the directory path.
// ---------------------------------------------------------------------------

function slugToDir(slug) {
  return slug.toLowerCase();
}

// ---------------------------------------------------------------------------
// Validation logic for a single project row
// ---------------------------------------------------------------------------

function validateProject(slug) {
  const dirName = slugToDir(slug);
  const historyPath = path.join(MONOREPO_ROOT, 'places', dirName, 'HISTORY.md');

  if (!fs.existsSync(historyPath)) {
    if (mode === 'fail') {
      emit('FAIL', slug, 'HISTORY.md missing', historyPath);
    } else {
      emit('WARN', slug, 'HISTORY.md missing', historyPath);
    }
    return null;
  }

  const content = fs.readFileSync(historyPath, 'utf8');

  // 1. Parse frontmatter
  const fm = parseFrontmatter(content);
  if (!fm) {
    emit('FAIL', slug, 'HISTORY.md has no YAML frontmatter (missing --- delimiters)', historyPath);
    return null;
  }

  let ok = true;

  // 2. Required frontmatter fields
  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    const val = fm[field];
    if (val === undefined || val === null || val === '') {
      emit('FAIL', slug, `HISTORY.md missing required field: ${field}`, historyPath);
      ok = false;
    }
  }

  // 3. schema_version
  if (fm.schema_version && !ALLOWED_SCHEMA_VERSIONS.includes(fm.schema_version)) {
    emit('FAIL', slug, `HISTORY.md schema_version "${fm.schema_version}" not in allowed set: ${ALLOWED_SCHEMA_VERSIONS.join(', ')}`, historyPath);
    ok = false;
  }

  // 4. research_status enum
  if (fm.research_status && !ALLOWED_RESEARCH_STATUSES.includes(fm.research_status)) {
    emit('FAIL', slug, `HISTORY.md research_status "${fm.research_status}" not in allowed set: ${ALLOWED_RESEARCH_STATUSES.join(', ')}`, historyPath);
    ok = false;
  }

  // 5. prt_slug must match the DB slug (case-sensitive)
  if (fm.prt_slug !== undefined && fm.prt_slug !== slug) {
    emit('WARN', slug, `HISTORY.md prt_slug "${fm.prt_slug}" does not match DB slug "${slug}" — check for case drift`, historyPath);
  }

  // 6. contributors must be an array (even if empty)
  if (fm.contributors !== undefined && !Array.isArray(fm.contributors)) {
    emit('FAIL', slug, 'HISTORY.md contributors must be an array (use [] for empty)', historyPath);
    ok = false;
  }

  // 7. location must be a non-null object
  if (fm.location !== undefined && (typeof fm.location !== 'object' || Array.isArray(fm.location))) {
    emit('FAIL', slug, 'HISTORY.md location must be a nested YAML object block', historyPath);
    ok = false;
  }

  // 8. Required body sections
  for (const section of REQUIRED_SECTIONS) {
    // Match heading with possible trailing whitespace or \r
    const re = new RegExp(`^${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    if (!re.test(content)) {
      emit('FAIL', slug, `HISTORY.md missing required section: "${section}"`, historyPath);
      ok = false;
    }
  }

  if (ok) {
    emit('PASS', slug, `HISTORY.md valid (research_status: ${fm.research_status || 'unknown'})`, historyPath);
  }

  return { fm, historyPath };
}

// ---------------------------------------------------------------------------
// Apply trigger predicate client-side (fetch all, filter here)
// ---------------------------------------------------------------------------

function matchesTriggerPredicate(row) {
  if (!TRIGGERING_PROJECT_TYPES.has(row.project_type)) return false;
  if (!row.name) return false;
  // geo_projects is an embedded resource array from PostgREST; non-empty = GIS data exists
  const hasGeoProject = Array.isArray(row.geo_projects) && row.geo_projects.length > 0;
  return (
    row.location_state !== null ||
    row.location_city !== null ||
    row.country !== null ||
    row.total_acres !== null ||
    row.lat !== null ||
    hasGeoProject
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!jsonOutput) {
    console.log(`\nvalidate-place-histories — mode=${mode}${slugFilter ? ` slug=${slugFilter}` : ''}\n`);
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

  // 2. Query prt_projects — fetch triggering columns for all non-template rows
  let rows;
  try {
    let qpath = '/rest/v1/prt_projects?is_template=neq.true&select=slug,name,project_type,location_state,location_city,country,total_acres,lat,geo_projects(id)&order=slug.asc';
    if (slugFilter) {
      qpath += `&slug=eq.${encodeURIComponent(slugFilter)}`;
    }
    rows = await supabaseGet(anonKey, qpath);
  } catch (err) {
    console.error(`ERROR: Supabase query failed — ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(rows)) {
    console.error('ERROR: unexpected response format from Supabase');
    process.exit(1);
  }

  // 3. Apply trigger predicate client-side
  const triggeringRows = rows.filter(matchesTriggerPredicate);

  if (triggeringRows.length === 0) {
    if (!jsonOutput) {
      console.log(
        slugFilter
          ? `No triggering prt_projects row found for slug: ${slugFilter}`
          : 'No prt_projects rows match the trigger predicate.'
      );
    }
    process.exit(0);
  }

  if (!jsonOutput) {
    console.log(`Found ${triggeringRows.length} triggering project(s) (from ${rows.length} total non-template rows)...\n`);
  }

  // 4. Validate each
  for (const row of triggeringRows) {
    validateProject(row.slug);
  }

  // 5. Summary
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
