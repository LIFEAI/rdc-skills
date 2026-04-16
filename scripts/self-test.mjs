#!/usr/bin/env node
// self-test.mjs — Tier 1 static linter for rdc-skills
//
// Validates every skill file in skills/ against a checklist:
//   1. File parseable (readable, has frontmatter)
//   2. Frontmatter YAML valid (name + description required)
//   3. description does NOT start with backtick (breaks Claude Code parser)
//   4. description contains a `Usage `rdc:<name>` marker matching this skill
//   5. frontmatter name matches filename (rdc:foo ↔ rdc-foo.md)
//   6. Every referenced guide file exists (guides/*.md references)
//   7. Every referenced rule file exists (.claude/rules/*.md references)
//   8. Body contains the standard output-contract banner
//   9. Plugin manifest (.claude-plugin/plugin.json) exists, parses, has name+version,
//      and version matches package.json
//  10. No duplicate skill names; no filename collisions with guides/agents/*.md
//  11. Hook files referenced by skills exist; orphan hook files get a warning
//
// Usage:
//   node scripts/self-test.mjs                  # run all, human output, exit 1 on fail
//   node scripts/self-test.mjs --json           # machine-readable schema v2
//   node scripts/self-test.mjs --skill rdc:foo  # single skill
//   node scripts/self-test.mjs --strict         # warnings become failures
//   node scripts/self-test.mjs --fix            # auto-repair fixable findings
//
// Exit codes:
//   0 = all pass
//   1 = at least one skill/guide failure
//   2 = runner crashed (unreadable dirs, etc.)
//   3 = plugin manifest missing (distinct from skill failures)

import { readFileSync, readdirSync, existsSync, writeFileSync, appendFileSync, renameSync, mkdirSync, statSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllManifests } from "./lib/manifest-schema.mjs";
import { runManifest } from "./lib/runner.mjs";
import {
  generateRunId,
  resolveSandboxRef,
  deleteSupabaseTestBranch,
  removeWorktree,
} from "./lib/sandbox.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const GUIDES_DIR = join(REPO_ROOT, "guides");
const AGENT_GUIDES_DIR = join(GUIDES_DIR, "agents");
const HOOKS_DIR = join(REPO_ROOT, "hooks");
const PLUGIN_MANIFEST = join(REPO_ROOT, ".claude-plugin", "plugin.json");
const PACKAGE_JSON = join(REPO_ROOT, "package.json");

const STANDARD_BANNER = [
  "> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`",
  "> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.",
  "> One checklist upfront, updated in place, shown again at end with a 1-line verdict.",
  "",
  "",
].join("\n");

const argv = process.argv.slice(2);
const args = new Set(argv);
const STRICT = args.has("--strict");
const JSON_OUT = args.has("--json");
const FIX = args.has("--fix");
const TIER2 = args.has("--tier2");
const QUICK = args.has("--quick");
const ONLY_SKILLS = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--skill" && argv[i + 1]) {
    for (const s of argv[i + 1].split(",")) {
      const t = s.trim();
      if (t) ONLY_SKILLS.push(t);
    }
    i++;
  }
}
const ONLY_SKILL = ONLY_SKILLS.length === 1 ? ONLY_SKILLS[0] : null; // backwards-compat for single-skill Tier 1 path
const parallelArgIdx = argv.indexOf("--parallel");
const PARALLEL = parallelArgIdx >= 0 ? Math.max(1, parseInt(argv[parallelArgIdx + 1], 10) || 3) : 3;
const logArgIdx = argv.indexOf("--log");
const LIVE_LOG = logArgIdx >= 0 ? argv[logArgIdx + 1] : null;

/** Append a timestamped line to the live log file (if --log was passed). */
function liveLog(kind, msg) {
  if (!LIVE_LOG) return;
  const ts = new Date().toISOString();
  try { appendFileSync(LIVE_LOG, `[${ts}] [${kind}] ${msg}\n`); } catch {}
}

// Track files modified by --fix so caller can git diff
const FIXED_FILES = [];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseFrontmatter(text) {
  text = text.replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { error: "no frontmatter block" };
  const raw = m[1];
  const body = text.slice(m[0].length);
  const fmEnd = m[0].length;

  const nameMatch = raw.match(/^name:\s*(.+?)\s*$/m);
  if (!nameMatch) return { error: "frontmatter missing `name:`" };
  const name = nameMatch[1].trim();

  let description = null;
  let descStartsWithBacktick = false;

  const plainDesc = raw.match(/^description:[ \t]+([^\n>| \t].*)$/m);
  const foldedDesc = raw.match(/^description:[ \t]*>[-+]?[ \t]*\n((?:[ \t]+.*(?:\n|$))+)/m);
  const literalDesc = raw.match(/^description:[ \t]*\|[-+]?[ \t]*\n((?:[ \t]+.*(?:\n|$))+)/m);

  if (plainDesc) {
    description = plainDesc[1].trim();
    descStartsWithBacktick = description.startsWith("`");
  } else if (foldedDesc || literalDesc) {
    const block = (foldedDesc || literalDesc)[1];
    const lines = block
      .split(/\n/)
      .map((l) => l.replace(/^[ \t]+/, ""))
      .filter((l) => l.length > 0);
    description = lines.join(foldedDesc ? " " : "\n").trim();
    const firstLine = lines[0] || "";
    descStartsWithBacktick = firstLine.startsWith("`");
  } else {
    return { error: "frontmatter missing `description:`" };
  }

  return { name, description, descStartsWithBacktick, body, raw, fmEnd };
}

function expectedSkillName(dirOrFile) {
  // Accept either a directory name (rdc-foo) or legacy filename (rdc-foo.md)
  const base = basename(dirOrFile, ".md");
  if (!base.startsWith("rdc-")) return null;
  return "rdc:" + base.slice(4);
}

function findReferencedFiles(body) {
  const refs = [];
  const guideRe = /(?:^|[\s(`'"/])(?:\.rdc\/)?guides\/([\w/-]+\.md)/g;
  let m;
  while ((m = guideRe.exec(body)) !== null) {
    refs.push({ kind: "guide", name: m[1] });
  }
  const ruleRe = /\.claude\/rules\/([\w-]+\.md)/g;
  while ((m = ruleRe.exec(body)) !== null) {
    refs.push({ kind: "rule", name: m[1] });
  }
  const hookRe = /(?:^|[\s(`'"/])hooks\/([\w.-]+\.(?:js|mjs|cjs))/g;
  while ((m = hookRe.exec(body)) !== null) {
    refs.push({ kind: "hook", name: m[1] });
  }
  return refs;
}

function addFinding(result, level, code, message) {
  result.findings.push({ level, code, message });
  if (level === "error") result.errors.push(message);
  else result.warnings.push(message);
}

function tryAutoFix(filepath, fm, text, result) {
  if (!FIX) return false;
  let changed = false;
  let newText = text;
  let newPath = filepath;

  // Fix: insert OUTPUT CONTRACT banner after frontmatter if missing
  if (!/OUTPUT CONTRACT/.test(fm.body)) {
    const fmBlock = newText.slice(0, fm.fmEnd);
    const rest = newText.slice(fm.fmEnd).replace(/^\n+/, "");
    newText = fmBlock + "\n" + STANDARD_BANNER + rest;
    writeFileSync(filepath, newText);
    console.log(`FIXED: ${result.name || result.file} — inserted OUTPUT CONTRACT banner`);
    FIXED_FILES.push(filepath);
    changed = true;
  }

  // Fix: filename/name mismatch — rename directory or file to match frontmatter name
  const _filename = basename(filepath);
  const _dirName = basename(dirname(filepath));
  const _isSubdir = _filename === "SKILL.md" && _dirName.startsWith("rdc-");
  const _skillDirOrFile = _isSubdir ? _dirName : _filename;
  const expected = expectedSkillName(_skillDirOrFile);
  if (expected && fm.name !== expected && fm.name.startsWith("rdc:")) {
    if (_isSubdir) {
      // Subdirectory layout: rename the parent directory
      const targetDirName = "rdc-" + fm.name.slice(4);
      const targetDirPath = join(dirname(dirname(filepath)), targetDirName);
      if (!existsSync(targetDirPath)) {
        renameSync(dirname(filepath), targetDirPath);
        const targetPath = join(targetDirPath, "SKILL.md");
        console.log(`FIXED: ${fm.name} — renamed dir ${_dirName} → ${targetDirName}`);
        FIXED_FILES.push(targetPath);
        newPath = targetPath;
        changed = true;
      }
    } else {
      const targetBase = "rdc-" + fm.name.slice(4) + ".md";
      const targetPath = join(dirname(filepath), targetBase);
      if (!existsSync(targetPath)) {
        renameSync(filepath, targetPath);
        console.log(`FIXED: ${fm.name} — renamed ${_filename} → ${targetBase}`);
        FIXED_FILES.push(targetPath);
        newPath = targetPath;
        changed = true;
      }
    }
  }

  return changed ? newPath : false;
}

function auditSkill(filepath) {
  const filename = basename(filepath);
  // Support both flat (rdc-foo.md) and subdirectory (rdc-foo/SKILL.md) layouts
  const dirName = basename(dirname(filepath)); // "rdc-foo" when filepath is .../rdc-foo/SKILL.md
  const isSubdir = filename === "SKILL.md" && dirName.startsWith("rdc-");
  const skillDirOrFile = isSubdir ? dirName : filename;
  const result = {
    skill: null,
    file: isSubdir ? `skills/${dirName}/SKILL.md` : `skills/${filename}`,
    name: null,
    pass: true,
    errors: [],
    warnings: [],
    findings: [],
  };

  let text;
  try {
    text = readFileSync(filepath, "utf8");
  } catch (e) {
    addFinding(result, "error", "unreadable", `cannot read file: ${e.message}`);
    result.pass = false;
    return result;
  }

  const fm = parseFrontmatter(text);
  if (fm.error) {
    addFinding(result, "error", "frontmatter-invalid", `frontmatter: ${fm.error}`);
    result.pass = false;
    return result;
  }

  result.name = fm.name;
  result.skill = fm.name;

  if (fm.descStartsWithBacktick) {
    addFinding(
      result,
      "error",
      "description-backtick-leading",
      "description starts with backtick — Claude Code parser will silently drop this skill from the menu",
    );
  }

  // Usage marker — must reference this skill's own name
  if (fm.name.startsWith("rdc:")) {
    const escapedName = escapeRegExp(fm.name);
    const usageRe = new RegExp("Usage\\s+`" + escapedName + "[ \\\\`]", "i");
    const anyUsageRe = /\bUsage\s+`/i;
    if (!anyUsageRe.test(fm.description)) {
      addFinding(
        result,
        "warn",
        "usage-marker-missing",
        "description missing `Usage \\`rdc:name <args>\\`` marker — users can't see arg contract in menu",
      );
    } else if (!usageRe.test(fm.description)) {
      addFinding(
        result,
        "warn",
        "usage-marker-mismatch",
        `Usage marker in description does not reference own name "${fm.name}" — copy-paste drift?`,
      );
    }
  }

  const expected = expectedSkillName(skillDirOrFile);
  if (expected && fm.name !== expected) {
    addFinding(
      result,
      "error",
      "name-filename-mismatch",
      `name mismatch: frontmatter says "${fm.name}" but filename implies "${expected}"`,
    );
  }

  const refs = findReferencedFiles(fm.body);
  const seen = new Set();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.kind === "guide") {
      if (!existsSync(join(GUIDES_DIR, ref.name))) {
        addFinding(
          result,
          "warn",
          "guide-not-found",
          `referenced guide not found in repo: guides/${ref.name}`,
        );
      }
    }
    if (ref.kind === "rule") {
      const regenRoot = "C:/Dev/regen-root/.claude/rules";
      if (existsSync(regenRoot) && !existsSync(join(regenRoot, ref.name))) {
        addFinding(
          result,
          "warn",
          "rule-not-found",
          `referenced rule not found in regen-root: .claude/rules/${ref.name}`,
        );
      }
    }
    if (ref.kind === "hook") {
      if (!existsSync(join(HOOKS_DIR, ref.name))) {
        addFinding(
          result,
          "error",
          "hook-not-found",
          `referenced hook file not found: hooks/${ref.name}`,
        );
      }
    }
  }

  if (!/OUTPUT CONTRACT/.test(fm.body)) {
    addFinding(
      result,
      "warn",
      "banner-missing",
      "body missing OUTPUT CONTRACT banner (guides/output-contract.md reference)",
    );
  }

  // Try auto-fix, then re-audit the same skill once to reflect new state
  if (FIX && (result.errors.length > 0 || result.warnings.length > 0)) {
    const newPath = tryAutoFix(filepath, fm, text, result);
    if (newPath) return auditSkill(newPath);
  }

  result.pass = result.errors.length === 0;
  return result;
}

function auditAgentGuide(filepath) {
  const filename = basename(filepath);
  const result = {
    file: `guides/agents/${filename}`,
    name: filename,
    pass: true,
    errors: [],
    warnings: [],
    findings: [],
  };
  let text;
  try {
    text = readFileSync(filepath, "utf8");
  } catch (e) {
    addFinding(result, "error", "unreadable", `cannot read file: ${e.message}`);
    result.pass = false;
    return result;
  }
  if (text.replace(/\r\n/g, "\n").startsWith("---\n")) {
    addFinding(
      result,
      "error",
      "agent-guide-has-frontmatter",
      "agent guide still has frontmatter — should be plain markdown",
    );
  }
  if (!/OUTPUT CONTRACT/.test(text)) {
    addFinding(result, "warn", "banner-missing", "body missing OUTPUT CONTRACT banner");
  }
  if (text.trim().length === 0) {
    addFinding(result, "error", "empty-file", "file is empty");
  }
  result.pass = result.errors.length === 0;
  return result;
}

// Plugin manifest check. Returns { ok, exitCode, findings }
function auditPluginManifest() {
  const findings = [];
  if (!existsSync(PLUGIN_MANIFEST)) {
    findings.push({
      level: "error",
      code: "manifest-missing",
      message: `.claude-plugin/plugin.json not found`,
    });
    return { ok: false, exitCode: 3, findings, manifest: null };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(PLUGIN_MANIFEST, "utf8"));
  } catch (e) {
    findings.push({
      level: "error",
      code: "manifest-invalid-json",
      message: `plugin.json invalid JSON: ${e.message}`,
    });
    return { ok: false, exitCode: 1, findings, manifest: null };
  }
  if (!manifest.name) {
    findings.push({ level: "error", code: "manifest-missing-name", message: "plugin.json missing `name`" });
  }
  if (!manifest.version) {
    findings.push({
      level: "error",
      code: "manifest-missing-version",
      message: "plugin.json missing `version`",
    });
  }
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
    if (manifest.version && pkg.version && manifest.version !== pkg.version) {
      findings.push({
        level: "error",
        code: "manifest-version-mismatch",
        message: `plugin.json version "${manifest.version}" ≠ package.json version "${pkg.version}"`,
      });
    }
  } catch (e) {
    findings.push({
      level: "warn",
      code: "package-json-unreadable",
      message: `could not read package.json for version cross-check: ${e.message}`,
    });
  }
  const ok = findings.every((f) => f.level !== "error");
  return { ok, exitCode: ok ? 0 : 1, findings, manifest };
}

// Duplicate skill name + filename collision check
function auditDuplicates(results) {
  const findings = [];
  const nameMap = new Map();
  for (const r of results) {
    if (!r.name) continue;
    if (nameMap.has(r.name)) {
      findings.push({
        level: "error",
        code: "duplicate-skill-name",
        message: `duplicate skill name "${r.name}" in ${nameMap.get(r.name)} and ${r.file}`,
      });
    } else {
      nameMap.set(r.name, r.file);
    }
  }
  if (existsSync(AGENT_GUIDES_DIR)) {
    const agentBases = new Set(
      readdirSync(AGENT_GUIDES_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => basename(f, ".md")),
    );
    for (const r of results) {
      // r.file is either "skills/rdc-foo/SKILL.md" or legacy "skills/rdc-foo.md"
      // Extract the skill directory/base name in both cases
      const parts = r.file.replace(/\\/g, "/").split("/");
      let skillBase;
      if (parts.length >= 3 && parts[2] === "SKILL.md") {
        skillBase = parts[1]; // "rdc-foo" from "skills/rdc-foo/SKILL.md"
      } else {
        skillBase = basename(r.file, ".md"); // legacy
      }
      if (skillBase.startsWith("rdc-")) {
        const stem = skillBase.slice(4);
        if (agentBases.has(stem)) {
          findings.push({
            level: "error",
            code: "skill-guide-filename-collision",
            message: `skills/${skillBase}/SKILL.md collides with guides/agents/${stem}.md (half-reverted move?)`,
          });
        }
      }
    }
  }
  return findings;
}

// Orphan hook scan — warn when hooks/ files aren't referenced anywhere
function auditOrphanHooks(results) {
  const findings = [];
  if (!existsSync(HOOKS_DIR)) return findings;
  let hookFiles;
  try {
    hookFiles = readdirSync(HOOKS_DIR).filter((f) => /\.(?:js|mjs|cjs)$/.test(f));
  } catch {
    return findings;
  }
  const referenced = new Set();
  for (const r of results) {
    for (const f of r.findings) {
      // no-op: findings don't carry refs. Re-scan body below.
    }
  }
  // Re-scan skill bodies + known config files for hook refs
  const sources = [
    ...readdirSync(SKILLS_DIR)
      .filter((f) => {
        if (!f.startsWith("rdc-")) return false;
        try { return statSync(join(SKILLS_DIR, f)).isDirectory(); } catch { return false; }
      })
      .map((f) => join(SKILLS_DIR, f, "SKILL.md")),
    join(REPO_ROOT, ".claude", "settings.json"),
    PLUGIN_MANIFEST,
  ];
  for (const src of sources) {
    if (!existsSync(src)) continue;
    try {
      const text = readFileSync(src, "utf8");
      // Match either "hooks/foo.js" paths or bare basenames (stem match)
      const pathRe = /hooks\/([\w.-]+\.(?:js|mjs|cjs))/g;
      let m;
      while ((m = pathRe.exec(text)) !== null) referenced.add(m[1]);
      for (const hf of hookFiles) {
        const stem = hf.replace(/\.(?:js|mjs|cjs)$/, "");
        if (text.includes(hf) || new RegExp("\\b" + escapeRegExp(stem) + "\\b").test(text)) {
          referenced.add(hf);
        }
      }
    } catch {}
  }
  for (const hf of hookFiles) {
    if (!referenced.has(hf)) {
      findings.push({
        level: "warn",
        code: "orphan-hook",
        message: `hooks/${hf} exists but is not referenced by any skill`,
      });
    }
  }
  return findings;
}

// ─── Tier 2 behavioral runner ──────────────────────────────────────────────

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { pass: false, error: e?.message || String(e) };
      }
    }
  }
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => lane());
  await Promise.all(lanes);
  return results;
}

async function runTier2() {
  console.log("\nrdc-skills self-test — Tier 2 (behavioral)\n");

  // Load manifests
  let all = loadAllManifests();
  if (ONLY_SKILLS.length > 0) {
    all = all.filter((m) => m.manifest && ONLY_SKILLS.includes(m.manifest.skill));
  }
  if (QUICK) {
    all = all.filter((m) => !(m.manifest?.fixture?.slow === true));
  }

  if (all.length === 0) {
    console.log("No manifests found in skills/tests/.");
    console.log("(Tier 2 will run once WP6/WP7 land baseline manifests.)");
    process.exit(STRICT ? 1 : 0);
  }

  // Reject invalid manifests up front
  const invalid = all.filter((m) => !m.ok);
  const valid = all.filter((m) => m.ok);
  for (const m of invalid) {
    console.error(`SKIP ${m.file}: ${m.errors.map((e) => `${e.path}: ${e.msg}`).join("; ")}`);
  }
  if (valid.length === 0) {
    console.error("No valid manifests to run.");
    process.exit(1);
  }

  const runId = generateRunId();
  console.log(`runId: ${runId}`);
  console.log(`manifests: ${valid.length} valid, ${invalid.length} invalid`);
  console.log(`parallel: ${PARALLEL}${QUICK ? "  quick" : ""}`);
  liveLog("start", `runId=${runId} skills=${valid.map((m) => m.manifest.skill).join(",")}`);

  // WP-A3: use resolveSandboxRef — defaults to main-db mode (no branch, no cost)
  const sandboxRef = await resolveSandboxRef({ runId });
  console.log(`sandbox mode: ${sandboxRef.mode}  apiUrl=${sandboxRef.apiUrl || "none"}  anonKey=${sandboxRef.anonKey ? "ok" : "missing"}`);
  liveLog("sandbox", `mode=${sandboxRef.mode} anonKey=${sandboxRef.anonKey ? "ok" : "missing"}`);

  // Run
  const toRun = valid.map((m) => m.manifest);
  const total = toRun.length;
  let launched = 0;
  let finished = 0;
  const started = Date.now();
  let results;
  try {
    results = await runPool(toRun, PARALLEL, async (manifest) => {
      const n = ++launched;
      const timeoutSec = Math.round((manifest.timeout_ms || 240_000) / 1000);
      console.log(`▶  [${n}/${total}] ${manifest.skill}  (timeout ${timeoutSec}s)`);
      liveLog("running", `skill=${manifest.skill}`);
      const r = await runManifest(manifest, {
        runId,
        supabaseBranchRef: sandboxRef,
        projectCwd: process.cwd(),
      });
      const done = ++finished;
      const status = r.error ? "ERROR" : r.pass ? "PASS" : "FAIL";
      const dur = r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "?";
      const icon = status === "PASS" ? "✓" : "✗";
      const detail = r.error || (r.failures || []).map((f) => f.message).join("; ") || "";
      console.log(
        `${icon}  [${done}/${total}] ${r.skill}  ${dur}  ${status}${detail ? "  — " + detail : ""}`,
      );
      liveLog(status.toLowerCase(), `skill=${r.skill} duration=${r.duration_ms}ms${detail ? " | " + detail : ""}`);
      return r;
    });
  } finally {
    // Teardown — always. Pass process.cwd() so removeWorktree targets the
    // same projectRoot (regen-root) that createWorktree used.
    const projectCwd = process.cwd();
    for (const r of results || []) {
      if (r && r.skill) {
        try { removeWorktree(runId, r.skill, projectCwd); } catch {}
      }
    }
    try { await deleteSupabaseTestBranch(sandboxRef.branchId); } catch {}
  }

  const totalDuration = Date.now() - started;

  // Report
  const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
  console.log("\n" + pad("skill", 24) + pad("status", 10) + pad("duration", 12) + "failures");
  console.log("─".repeat(90));
  let failed = 0;
  let errored = 0;
  for (const r of results) {
    if (r.error) {
      errored++;
      console.log(pad(r.skill || "?", 24) + pad("ERROR", 10) + pad("-", 12) + r.error);
      continue;
    }
    const status = r.pass ? "pass" : "FAIL";
    if (!r.pass) failed++;
    const dur = `${r.duration_ms}ms`;
    const fs = (r.failures || []).map((f) => `${f.predicate}: ${f.message}`).join("; ") || "";
    console.log(pad(r.skill, 24) + pad(status, 10) + pad(dur, 12) + fs);
  }
  console.log("─".repeat(90));
  console.log(
    `total: ${results.length}  |  pass: ${results.length - failed - errored}  |  fail: ${failed}  |  error: ${errored}  |  wall: ${totalDuration}ms`,
  );
  liveLog("done", `total=${results.length} pass=${results.length - failed - errored} fail=${failed} error=${errored} wall=${totalDuration}ms`);

  // JSON dump
  try {
    const REPORTS_DIR = resolve(REPO_ROOT, ".rdc", "reports");
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = join(REPORTS_DIR, `self-test-tier2-${iso}.json`);
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          run_id: runId,
          started_at: new Date(started).toISOString(),
          duration_ms: totalDuration,
          parallel: PARALLEL,
          quick: QUICK,
          supabase_branch: sandboxRef.branchId || null,
          summary: {
            total: results.length,
            pass: results.length - failed - errored,
            fail: failed,
            error: errored,
          },
          results,
          invalid_manifests: invalid.map((m) => ({ file: m.file, errors: m.errors })),
        },
        null,
        2,
      ),
    );
    console.log(`\nreport: ${reportPath}`);
  } catch (e) {
    console.error(`WARN: failed to write JSON report: ${e.message}`);
  }

  writeLastRun({
    tier: 2,
    verdict: (failed > 0 || errored > 0) ? "FAIL" : "PASS",
    exit_code: errored > 0 ? 2 : failed > 0 ? 1 : 0,
    summary: {
      total: results.length,
      passed: results.length - failed - errored,
      failed,
      errored,
      wall_ms: totalDuration,
    },
    failures: results
      .filter((r) => !r.pass || r.error)
      .map((r) => ({
        skill: r.skill,
        error: r.error || null,
        timed_out: r.observed?.timed_out || false,
        assertions_failed: (r.failures || []).map((f) => `${f.predicate}: ${f.message}`),
      })),
    warnings: [],
  });

  if (errored > 0) process.exit(2);
  process.exit(failed > 0 ? 1 : 0);
}

function main() {
  // Plugin manifest pass first — can short-circuit with exit 3
  const manifestAudit = auditPluginManifest();
  const manifestMissing = manifestAudit.findings.some((f) => f.code === "manifest-missing");

  let files;
  try {
    files = readdirSync(SKILLS_DIR).filter((f) => {
      if (!f.startsWith("rdc-")) return false;
      try { return statSync(join(SKILLS_DIR, f)).isDirectory(); } catch { return false; }
    });
  } catch (e) {
    console.error(`FATAL: cannot read skills dir ${SKILLS_DIR}: ${e.message}`);
    process.exit(2);
  }

  if (ONLY_SKILLS.length > 0) {
    files = files.filter((f) => {
      return ONLY_SKILLS.some((s) => f === s.replace(":", "-"));
    });
    if (files.length === 0) {
      console.error(`no skill file matches: ${ONLY_SKILLS.join(", ")}`);
      process.exit(2);
    }
  }

  if (JSON_OUT) {
    // JSON path: buffer everything then dump
    const results = files.map((f) => auditSkill(join(SKILLS_DIR, f, "SKILL.md")));

    let duplicateFindings = [];
    let orphanHookFindings = [];
    if (!ONLY_SKILL) {
      duplicateFindings = auditDuplicates(results);
      orphanHookFindings = auditOrphanHooks(results);
    }

    let agentResults = [];
    if (!ONLY_SKILL && existsSync(AGENT_GUIDES_DIR)) {
      const agentFiles = readdirSync(AGENT_GUIDES_DIR).filter((f) => f.endsWith(".md"));
      agentResults = agentFiles.map((f) => auditAgentGuide(join(AGENT_GUIDES_DIR, f)));
    }

    const failed = results.filter((r) => r.errors.length > 0);
    const warned = results.filter((r) => r.warnings.length > 0 && r.errors.length === 0);
    const clean = results.filter((r) => r.errors.length === 0 && r.warnings.length === 0);
    const agentFailed = agentResults.filter((r) => r.errors.length > 0);
    const agentWarned = agentResults.filter((r) => r.warnings.length > 0 && r.errors.length === 0);
    const agentClean = agentResults.filter((r) => r.errors.length === 0 && r.warnings.length === 0);
    const globalErrors = [
      ...manifestAudit.findings.filter((f) => f.level === "error"),
      ...duplicateFindings.filter((f) => f.level === "error"),
      ...orphanHookFindings.filter((f) => f.level === "error"),
    ];
    const globalWarnings = [
      ...manifestAudit.findings.filter((f) => f.level === "warn"),
      ...duplicateFindings.filter((f) => f.level === "warn"),
      ...orphanHookFindings.filter((f) => f.level === "warn"),
    ];
    const fail =
      failed.length > 0 ||
      agentFailed.length > 0 ||
      globalErrors.length > 0 ||
      (STRICT && (warned.length > 0 || agentWarned.length > 0 || globalWarnings.length > 0));
    let exitCode = fail ? 1 : 0;
    if (manifestMissing) exitCode = 3;

    console.log(
      JSON.stringify(
        {
          summary: {
            total: results.length,
            failed: failed.length,
            warned: warned.length,
            clean: clean.length,
            strict: STRICT,
            fix: FIX,
            fixed_files: FIXED_FILES.map((p) => p.replace(REPO_ROOT + "\\", "").replace(REPO_ROOT + "/", "")),
            verdict: fail ? "FAIL" : "PASS",
            exit_code: exitCode,
          },
          plugin_manifest: {
            ok: manifestAudit.ok,
            version: manifestAudit.manifest?.version || null,
            findings: manifestAudit.findings,
          },
          global_findings: [...duplicateFindings, ...orphanHookFindings],
          results: results.map((r) => ({
            skill: r.skill,
            file: r.file,
            pass: r.pass,
            findings: r.findings,
          })),
          agent_guides: {
            total: agentResults.length,
            failed: agentFailed.length,
            warned: agentWarned.length,
            clean: agentClean.length,
            results: agentResults.map((r) => ({
              file: r.file,
              pass: r.pass,
              findings: r.findings,
            })),
          },
        },
        null,
        2,
      ),
    );
    process.exit(exitCode);
  }

  // Human-readable path: stream each result live as it's audited
  const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));

  // Count agent guides upfront for the startup banner
  let agentFileCount = 0;
  if (!ONLY_SKILL && existsSync(AGENT_GUIDES_DIR)) {
    try { agentFileCount = readdirSync(AGENT_GUIDES_DIR).filter((f) => f.endsWith(".md")).length; } catch {}
  }

  // Startup banner — printed immediately so the user sees activity right away
  console.log(`\nrdc-skills self-test — Tier 1 (static lint)`);
  const scopeDesc = ONLY_SKILLS.length > 0
    ? `skill: ${ONLY_SKILLS.join(", ")}`
    : `${files.length} skill${files.length !== 1 ? "s" : ""}${agentFileCount ? ` + ${agentFileCount} agent guide${agentFileCount !== 1 ? "s" : ""}` : ""}`;
  console.log(`Scanning ${scopeDesc}${STRICT ? "  [strict]" : ""}${FIX ? "  [fix]" : ""}\n`);

  // Plugin manifest line
  const manifestStatus = manifestAudit.ok ? "pass" : "FAIL";
  const manifestNote = manifestAudit.ok
    ? `v${manifestAudit.manifest?.version || "?"}`
    : manifestAudit.findings.map((f) => f.message).join("; ");
  console.log(pad("plugin manifest", 24) + pad(manifestStatus, 10) + manifestNote);
  console.log();

  // Skills — print each row immediately after audit (no buffering)
  console.log(pad("skill", 24) + pad("status", 10) + "notes");
  console.log("─".repeat(80));
  const results = [];
  for (const f of files) {
    const r = auditSkill(join(SKILLS_DIR, f, "SKILL.md"));
    results.push(r);
    const status = r.errors.length > 0 ? "FAIL" : r.warnings.length > 0 ? "WARN" : "pass";
    const notes = r.errors.length > 0 ? r.errors[0] : r.warnings[0] || "";
    console.log(pad(r.name || r.file, 24) + pad(status, 10) + notes);
    const extras = [...r.errors.slice(1), ...r.warnings.slice(r.errors.length > 0 ? 0 : 1)];
    for (const extra of extras) {
      console.log(pad("", 24) + pad("", 10) + "  " + extra);
    }
  }

  const failed = results.filter((r) => r.errors.length > 0);
  const warned = results.filter((r) => r.warnings.length > 0 && r.errors.length === 0);
  const clean = results.filter((r) => r.errors.length === 0 && r.warnings.length === 0);

  console.log("─".repeat(80));
  console.log(`total: ${results.length}  |  fail: ${failed.length}  |  warn: ${warned.length}  |  pass: ${clean.length}`);

  // Agent guides — stream live
  const agentResults = [];
  if (!ONLY_SKILL && existsSync(AGENT_GUIDES_DIR)) {
    const agentFiles = readdirSync(AGENT_GUIDES_DIR).filter((f) => f.endsWith(".md"));
    if (agentFiles.length > 0) {
      console.log("\nagent guides (guides/agents/*.md)\n");
      console.log(pad("guide", 24) + pad("status", 10) + "notes");
      console.log("─".repeat(80));
      for (const f of agentFiles) {
        const r = auditAgentGuide(join(AGENT_GUIDES_DIR, f));
        agentResults.push(r);
        const status = r.errors.length > 0 ? "FAIL" : r.warnings.length > 0 ? "WARN" : "pass";
        const notes = r.errors.length > 0 ? r.errors[0] : r.warnings[0] || "";
        console.log(pad(r.file, 24) + pad(status, 10) + notes);
        const extras = [...r.errors.slice(1), ...r.warnings.slice(r.errors.length > 0 ? 0 : 1)];
        for (const extra of extras) {
          console.log(pad("", 24) + pad("", 10) + "  " + extra);
        }
      }
      const agentFailed = agentResults.filter((r) => r.errors.length > 0);
      const agentWarned = agentResults.filter((r) => r.warnings.length > 0 && r.errors.length === 0);
      const agentClean = agentResults.filter((r) => r.errors.length === 0 && r.warnings.length === 0);
      console.log("─".repeat(80));
      console.log(`total: ${agentResults.length}  |  fail: ${agentFailed.length}  |  warn: ${agentWarned.length}  |  pass: ${agentClean.length}`);
    }
  }

  // Cross-skill checks — deferred until all audits complete
  let duplicateFindings = [];
  let orphanHookFindings = [];
  if (!ONLY_SKILL) {
    duplicateFindings = auditDuplicates(results);
    orphanHookFindings = auditOrphanHooks(results);
  }

  if (duplicateFindings.length + orphanHookFindings.length > 0) {
    console.log("\nglobal findings\n");
    for (const f of [...duplicateFindings, ...orphanHookFindings]) {
      console.log(`  [${f.level}] ${f.code}: ${f.message}`);
    }
  }

  if (FIXED_FILES.length > 0) {
    console.log("\nfixed files (review with git diff):");
    for (const p of FIXED_FILES) console.log(`  ${p}`);
  }

  const agentFailed = agentResults.filter((r) => r.errors.length > 0);
  const agentWarned = agentResults.filter((r) => r.warnings.length > 0 && r.errors.length === 0);
  const globalErrors = [
    ...manifestAudit.findings.filter((f) => f.level === "error"),
    ...duplicateFindings.filter((f) => f.level === "error"),
    ...orphanHookFindings.filter((f) => f.level === "error"),
  ];
  const globalWarnings = [
    ...manifestAudit.findings.filter((f) => f.level === "warn"),
    ...duplicateFindings.filter((f) => f.level === "warn"),
    ...orphanHookFindings.filter((f) => f.level === "warn"),
  ];

  const fail =
    failed.length > 0 ||
    agentFailed.length > 0 ||
    globalErrors.length > 0 ||
    (STRICT && (warned.length > 0 || agentWarned.length > 0 || globalWarnings.length > 0));

  let exitCode = fail ? 1 : 0;
  if (manifestMissing) exitCode = 3;

  console.log(`\nverdict: ${fail ? "❌ FAIL" : "✓ PASS"}${STRICT ? " (strict)" : ""}  exit=${exitCode}\n`);

  writeLastRun({
    tier: 1,
    verdict: fail ? "FAIL" : "PASS",
    exit_code: exitCode,
    strict: STRICT,
    summary: {
      total: results.length,
      failed: failed.length,
      warned: warned.length,
      passed: clean.length,
    },
    failures: [
      ...manifestAudit.findings.filter((f) => f.level === "error").map((f) => ({
        scope: "plugin_manifest", code: f.code, message: f.message,
      })),
      ...failed.map((r) => ({ skill: r.skill || r.file, errors: r.errors, findings: r.findings })),
      ...agentFailed.map((r) => ({ scope: "agent_guide", file: r.file, errors: r.errors, findings: r.findings })),
      ...duplicateFindings.filter((f) => f.level === "error").map((f) => ({ scope: "global", code: f.code, message: f.message })),
      ...orphanHookFindings.filter((f) => f.level === "error").map((f) => ({ scope: "global", code: f.code, message: f.message })),
    ],
    warnings: [
      ...warned.map((r) => ({ skill: r.skill || r.file, warnings: r.warnings })),
      ...agentWarned.map((r) => ({ scope: "agent_guide", file: r.file, warnings: r.warnings })),
    ],
  });

  process.exit(exitCode);
}

// ── last-run.json ───────────────────────────────────────────────────────────
// Always written after every run so Claude Code can read it without the user
// having to copy/paste terminal output.
// Path: C:/Dev/rdc-skills/.rdc/reports/last-run.json
//
// Shape:
//   { tier, ran_at, verdict, exit_code, summary, failures[], warnings[] }
// "failures" contains only items that actually failed — ready to act on.

function writeLastRun(data) {
  try {
    const reportsDir = resolve(REPO_ROOT, ".rdc", "reports");
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
    const outPath = join(reportsDir, "last-run.json");
    writeFileSync(outPath, JSON.stringify({ ...data, ran_at: new Date().toISOString() }, null, 2));
    console.log(`\nlast-run: ${outPath}`);
  } catch (e) {
    console.error(`WARN: could not write last-run.json: ${e.message}`);
  }
}

if (TIER2) {
  runTier2().catch((e) => {
    console.error(`FATAL: ${e.stack || e.message}`);
    process.exit(2);
  });
} else {
  try {
    main();
  } catch (e) {
    console.error(`FATAL: ${e.stack || e.message}`);
    process.exit(2);
  }
}
