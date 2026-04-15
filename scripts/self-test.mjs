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

import { readFileSync, readdirSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const skillArgIdx = argv.indexOf("--skill");
const ONLY_SKILL = skillArgIdx >= 0 ? argv[skillArgIdx + 1] : null;

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

function expectedSkillName(filename) {
  const base = basename(filename, ".md");
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

  // Fix: filename/name mismatch — rename file to match frontmatter name
  const expected = expectedSkillName(basename(filepath));
  if (expected && fm.name !== expected && fm.name.startsWith("rdc:")) {
    const targetBase = "rdc-" + fm.name.slice(4) + ".md";
    const targetPath = join(dirname(filepath), targetBase);
    if (!existsSync(targetPath)) {
      renameSync(filepath, targetPath);
      console.log(`FIXED: ${fm.name} — renamed ${basename(filepath)} → ${targetBase}`);
      FIXED_FILES.push(targetPath);
      newPath = targetPath;
      changed = true;
    }
  }

  return changed ? newPath : false;
}

function auditSkill(filepath) {
  const filename = basename(filepath);
  const result = {
    skill: null,
    file: `skills/${filename}`,
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

  const expected = expectedSkillName(filename);
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
      const skillBase = basename(r.file, ".md"); // "rdc-foo"
      if (skillBase.startsWith("rdc-")) {
        const stem = skillBase.slice(4);
        if (agentBases.has(stem)) {
          findings.push({
            level: "error",
            code: "skill-guide-filename-collision",
            message: `skills/${skillBase}.md collides with guides/agents/${stem}.md (half-reverted move?)`,
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
      .filter((f) => f.startsWith("rdc-") && f.endsWith(".md"))
      .map((f) => join(SKILLS_DIR, f)),
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

function main() {
  // Plugin manifest pass first — can short-circuit with exit 3
  const manifestAudit = auditPluginManifest();
  const manifestMissing = manifestAudit.findings.some((f) => f.code === "manifest-missing");

  let files;
  try {
    files = readdirSync(SKILLS_DIR).filter((f) => f.startsWith("rdc-") && f.endsWith(".md"));
  } catch (e) {
    console.error(`FATAL: cannot read skills dir ${SKILLS_DIR}: ${e.message}`);
    process.exit(2);
  }

  if (ONLY_SKILL) {
    const wanted = ONLY_SKILL.replace(":", "-") + ".md";
    files = files.filter((f) => f === wanted);
    if (files.length === 0) {
      console.error(`no skill file matches ${ONLY_SKILL}`);
      process.exit(2);
    }
  }

  const results = files.map((f) => auditSkill(join(SKILLS_DIR, f)));

  // Cross-skill checks (skip on --skill single-file runs)
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
    (STRICT &&
      (warned.length > 0 || agentWarned.length > 0 || globalWarnings.length > 0));

  // Exit code 3 reserved for missing plugin manifest
  let exitCode = fail ? 1 : 0;
  if (manifestMissing) exitCode = 3;

  if (JSON_OUT) {
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
  } else {
    const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
    console.log("\nrdc-skills self-test — Tier 1 (static lint)\n");

    // Plugin manifest line
    const manifestStatus = manifestAudit.ok ? "pass" : "FAIL";
    const manifestNote = manifestAudit.ok
      ? `v${manifestAudit.manifest?.version || "?"}`
      : manifestAudit.findings.map((f) => f.message).join("; ");
    console.log(pad("plugin manifest", 24) + pad(manifestStatus, 10) + manifestNote);
    console.log();

    console.log(pad("skill", 24) + pad("status", 10) + "notes");
    console.log("─".repeat(80));
    for (const r of results) {
      const status = r.errors.length > 0 ? "FAIL" : r.warnings.length > 0 ? "WARN" : "pass";
      const notes = r.errors.length > 0 ? r.errors[0] : r.warnings[0] || "";
      console.log(pad(r.name || r.file, 24) + pad(status, 10) + notes);
      const extras = [...r.errors.slice(1), ...r.warnings.slice(r.errors.length > 0 ? 0 : 1)];
      for (const extra of extras) {
        console.log(pad("", 24) + pad("", 10) + "  " + extra);
      }
    }
    console.log("─".repeat(80));
    console.log(
      `total: ${results.length}  |  fail: ${failed.length}  |  warn: ${warned.length}  |  pass: ${clean.length}`,
    );

    if (agentResults.length > 0) {
      console.log("\nagent guides (guides/agents/*.md)\n");
      console.log(pad("guide", 24) + pad("status", 10) + "notes");
      console.log("─".repeat(80));
      for (const r of agentResults) {
        const status = r.errors.length > 0 ? "FAIL" : r.warnings.length > 0 ? "WARN" : "pass";
        const notes = r.errors.length > 0 ? r.errors[0] : r.warnings[0] || "";
        console.log(pad(r.file, 24) + pad(status, 10) + notes);
        const extras = [...r.errors.slice(1), ...r.warnings.slice(r.errors.length > 0 ? 0 : 1)];
        for (const extra of extras) {
          console.log(pad("", 24) + pad("", 10) + "  " + extra);
        }
      }
      console.log("─".repeat(80));
      console.log(
        `total: ${agentResults.length}  |  fail: ${agentFailed.length}  |  warn: ${agentWarned.length}  |  pass: ${agentClean.length}`,
      );
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

    console.log(`\nverdict: ${fail ? "❌ FAIL" : "✓ PASS"}${STRICT ? " (strict)" : ""}  exit=${exitCode}\n`);
  }

  process.exit(exitCode);
}

try {
  main();
} catch (e) {
  console.error(`FATAL: ${e.stack || e.message}`);
  process.exit(2);
}
