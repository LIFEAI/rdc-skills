#!/usr/bin/env node
// test-guide-validator.mjs — Unit test for the guide-content validator
//
// Proves:
//   1. The validator flags guides containing banned terms in positive-instruction context
//   2. The validator passes guides that mention banned terms only as warnings/negations
//   3. The validator flags unknown clauth key names
//   4. The validator passes known clauth key names
//
// Usage:
//   node scripts/test-guide-validator.mjs
//
// Exit codes:
//   0 = all assertions pass
//   1 = one or more assertions failed

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// Import the validator functions from self-test.mjs by running it in test mode.
// Since self-test.mjs is not a module that exports cleanly, we replicate the
// validator logic here using the same constants and algorithms.
// (The shared implementation lives in runGuideContentValidator / auditGuideFile.)
//
// We import via dynamic import of the self-test module's exported helpers —
// but since self-test.mjs has no exports (it runs immediately), we inline
// the equivalent test using the same fixture files it targets.

// ─── Inline validator (mirrors self-test.mjs logic) ────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";

const GUIDE_BANNED_TERMS = [
  "@masonator/coolify-mcp",
  "@masonator",
  "coolify-mcp",
  "@regen/brand-studio",
  "brand-studio",
];

const GUIDE_NEGATION_PATTERNS = [
  /\bdo not\b/i,
  /\bnever\b/i,
  /\bno such\b/i,
  /\bdoes not exist\b/i,
  /\bbanned\b/i,
  /\bnot reference\b/i,
  /\bnot use\b/i,
  /\bavoid\b/i,
  /\bremoved\b/i,
  /\bdeprecated\b/i,
  // Markdown table row showing a WRONG→CORRECT mapping (naming-corrections.md pattern)
  /^\|[^|]*WRONG[^|]*\|/i,
  // A table row where the term is in the WRONG column (first data column after the | WRONG | header)
  /^\|\s*(Brand Studio|brand-studio|@regen\/brand-studio|@masonator[^ |]*|coolify-mcp)[^|]*\|\s*\*\*/,
];

const KNOWN_CLAUTH_KEYS = new Set([
  "coolify-api",
  "cloudflare",
  "npm",
  "supabase",
  "supabase-anon",
  "supabase-db",
  "r2-access-key-id",
  "r2-secret-key",
  "anthropic",
  "openai",
  "github",
  "github-token",
  "vultr-dev-ssh",
  "mcp-web-research-secret",
  "mcp-regen-media-secret",
  "web-research",
  "regen-media",
]);

function auditGuideFile(filepath, relPath) {
  const findings = [];
  let text;
  try {
    text = readFileSync(filepath, "utf8");
  } catch (e) {
    findings.push({ level: "error", code: "guide-unreadable", file: relPath, line: 0, message: `cannot read: ${e.message}` });
    return findings;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    for (const term of GUIDE_BANNED_TERMS) {
      if (line.includes(term)) {
        const isNegated = GUIDE_NEGATION_PATTERNS.some((re) => re.test(line));
        if (!isNegated) {
          findings.push({ level: "error", code: "guide-banned-term", file: relPath, line: lineNo, message: `banned term "${term}"` });
        }
      }
    }
    const clauthKeyRe = /\bhttp:\/\/127\.0\.0\.1:52437\/v\/([\w-]+)/g;
    let m;
    while ((m = clauthKeyRe.exec(line)) !== null) {
      const key = m[1];
      if (!KNOWN_CLAUTH_KEYS.has(key)) {
        findings.push({ level: "warn", code: "guide-clauth-key-unknown", file: relPath, line: lineNo, message: `unknown clauth key "${key}"` });
      }
    }
  });
  return findings;
}

function scanDir(dir, prefix) {
  const findings = [];
  if (!existsSync(dir)) return findings;
  let entries;
  try { entries = readdirSync(dir); } catch { return findings; }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      findings.push(...scanDir(fullPath, `${prefix}/${entry}`));
    } else if (entry.endsWith(".md")) {
      findings.push(...auditGuideFile(fullPath, `${prefix}/${entry}`));
    }
  }
  return findings;
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(description, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${description}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("\nrdc:self-test — guide-content validator unit tests\n");

// ─── Test 1: bad-guide.md should produce errors for banned terms ─────────────
console.log("Test 1: bad-guide.md flags banned terms");
const BAD_FIXTURE = join(REPO_ROOT, "scripts/fixtures/guides/bad-guide.md");
const badFindings = auditGuideFile(BAD_FIXTURE, "fixtures/guides/bad-guide.md");
const badErrors = badFindings.filter((f) => f.level === "error" && f.code === "guide-banned-term");
assert("bad-guide.md produces at least 2 banned-term errors", badErrors.length >= 2, `got ${badErrors.length}`);
assert("flags @masonator/coolify-mcp", badErrors.some((f) => f.message.includes("@masonator/coolify-mcp")));
assert("flags brand-studio or @regen/brand-studio", badErrors.some((f) => f.message.includes("brand-studio")));

// ─── Test 2: bad-guide.md flags unknown clauth key ───────────────────────────
console.log("\nTest 2: bad-guide.md flags unknown clauth key");
const badKeyWarnings = badFindings.filter((f) => f.code === "guide-clauth-key-unknown");
assert("bad-guide.md warns on unknown clauth key 'nonexistent-key'", badKeyWarnings.length >= 1, `got ${badKeyWarnings.length}`);
assert("warning message references nonexistent-key", badKeyWarnings.some((f) => f.message.includes("nonexistent-key")));

// ─── Test 3: good-guide.md produces no errors (negated mentions are OK) ──────
console.log("\nTest 3: good-guide.md passes (negated mentions are not flagged)");
const GOOD_FIXTURE = join(REPO_ROOT, "scripts/fixtures/guides-clean/good-guide.md");
const goodFindings = auditGuideFile(GOOD_FIXTURE, "fixtures/guides-clean/good-guide.md");
const goodErrors = goodFindings.filter((f) => f.level === "error");
assert("good-guide.md produces 0 banned-term errors", goodErrors.length === 0, `got ${goodErrors.length}: ${goodErrors.map((f) => f.message).join("; ")}`);

// good-guide uses coolify-api which is a known key — no key warnings
const goodKeyWarnings = goodFindings.filter((f) => f.code === "guide-clauth-key-unknown");
assert("good-guide.md produces 0 unknown-key warnings", goodKeyWarnings.length === 0, `got ${goodKeyWarnings.length}`);

// ─── Test 4: scan fixture directory returns combined findings ─────────────────
console.log("\nTest 4: scanDir finds findings across fixture dirs");
const BAD_DIR = join(REPO_ROOT, "scripts/fixtures/guides");
const dirFindings = scanDir(BAD_DIR, "fixtures");
const dirErrors = dirFindings.filter((f) => f.level === "error");
assert("scanDir on bad fixture dir returns errors", dirErrors.length >= 2, `got ${dirErrors.length}`);

const GOOD_DIR = join(REPO_ROOT, "scripts/fixtures/guides-clean");
const cleanFindings = scanDir(GOOD_DIR, "fixtures");
const cleanErrors = cleanFindings.filter((f) => f.level === "error");
assert("scanDir on clean fixture dir returns 0 errors", cleanErrors.length === 0, `got ${cleanErrors.length}`);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`guide-validator tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n❌ FAIL — ${failed} assertion(s) did not pass`);
  process.exit(1);
} else {
  console.log(`\n✓ PASS — all guide-content validator assertions passed`);
  process.exit(0);
}
