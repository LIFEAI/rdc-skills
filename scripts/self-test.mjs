#!/usr/bin/env node
// self-test.mjs — Tier 1 static linter for rdc-skills
//
// Validates every skill file in skills/ against a checklist:
//   1. File parseable (readable, has frontmatter)
//   2. Frontmatter YAML valid (name + description required)
//   3. description does NOT start with backtick (breaks Claude Code parser)
//   4. description contains a `Usage ` marker (arg contract convention)
//   5. frontmatter name matches filename (rdc:foo ↔ rdc-foo.md)
//   6. Every referenced guide file exists (guides/*.md references)
//   7. Every referenced rule file exists (.claude/rules/*.md references)
//   8. Body contains the standard output-contract banner
//
// Usage:
//   node scripts/self-test.mjs                  # run all, human output, exit 1 on fail
//   node scripts/self-test.mjs --json           # machine-readable
//   node scripts/self-test.mjs --skill rdc:foo  # single skill
//   node scripts/self-test.mjs --strict         # warnings become failures
//
// Exit codes: 0 = all pass, 1 = at least one failure, 2 = runner crashed

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const GUIDES_DIR = join(REPO_ROOT, "guides");
const AGENT_GUIDES_DIR = join(GUIDES_DIR, "agents");

const args = new Set(process.argv.slice(2));
const STRICT = args.has("--strict");
const JSON_OUT = args.has("--json");
const argv = process.argv.slice(2);
const skillArgIdx = argv.indexOf("--skill");
const ONLY_SKILL = skillArgIdx >= 0 ? argv[skillArgIdx + 1] : null;

function parseFrontmatter(text) {
  // Normalize line endings up-front so downstream regexes don't have to care.
  text = text.replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { error: "no frontmatter block" };
  const raw = m[1];
  const body = text.slice(m[0].length);

  // Minimal YAML: name + description (scalar or folded)
  const nameMatch = raw.match(/^name:\s*(.+?)\s*$/m);
  if (!nameMatch) return { error: "frontmatter missing `name:`" };
  const name = nameMatch[1].trim();

  // description can be plain, folded (>-), or literal (|-)
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
    // For folded scalars, the parser rejection happens when the FIRST non-space
    // char after `>-\n  ` is a backtick — that's what breaks Claude Code.
    const firstLine = lines[0] || "";
    descStartsWithBacktick = firstLine.startsWith("`");
  } else {
    return { error: "frontmatter missing `description:`" };
  }

  return { name, description, descStartsWithBacktick, body, raw };
}

function expectedSkillName(filename) {
  // rdc-foo.md -> rdc:foo
  const base = basename(filename, ".md");
  if (!base.startsWith("rdc-")) return null;
  return "rdc:" + base.slice(4);
}

function findReferencedFiles(body) {
  const refs = [];
  // guides/<file>.md   or   .rdc/guides/<file>.md
  const guideRe = /(?:^|[\s(`'"/])(?:\.rdc\/)?guides\/([\w-]+\.md)/g;
  let m;
  while ((m = guideRe.exec(body)) !== null) {
    refs.push({ kind: "guide", name: m[1] });
  }
  // .claude/rules/<file>.md
  const ruleRe = /\.claude\/rules\/([\w-]+\.md)/g;
  while ((m = ruleRe.exec(body)) !== null) {
    refs.push({ kind: "rule", name: m[1] });
  }
  return refs;
}

function auditSkill(filepath) {
  const filename = basename(filepath);
  const result = {
    file: filename,
    name: null,
    errors: [],
    warnings: [],
  };

  let text;
  try {
    text = readFileSync(filepath, "utf8");
  } catch (e) {
    result.errors.push(`cannot read file: ${e.message}`);
    return result;
  }

  const fm = parseFrontmatter(text);
  if (fm.error) {
    result.errors.push(`frontmatter: ${fm.error}`);
    return result;
  }

  result.name = fm.name;

  // Check 3: backtick-leading description (silent parser rejection)
  if (fm.descStartsWithBacktick) {
    result.errors.push(
      "description starts with backtick — Claude Code parser will silently drop this skill from the menu",
    );
  }

  // Check 4: Usage line present
  if (!/\bUsage\s+`/i.test(fm.description)) {
    result.warnings.push(
      "description missing `Usage \\`rdc:name <args>\\`` marker — users can't see arg contract in menu",
    );
  }

  // Check 5: name matches filename
  const expected = expectedSkillName(filename);
  if (expected && fm.name !== expected) {
    result.errors.push(`name mismatch: frontmatter says "${fm.name}" but filename implies "${expected}"`);
  }

  // Check 6+7: referenced files exist
  const refs = findReferencedFiles(fm.body);
  const seen = new Set();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.kind === "guide") {
      if (!existsSync(join(GUIDES_DIR, ref.name))) {
        result.warnings.push(`referenced guide not found in repo: guides/${ref.name}`);
      }
    }
    // Rule files live in the consumer repo (.claude/rules/) — we only warn
    // when the skill references a rule that doesn't exist in regen-root.
    if (ref.kind === "rule") {
      const regenRoot = "C:/Dev/regen-root/.claude/rules";
      if (existsSync(regenRoot) && !existsSync(join(regenRoot, ref.name))) {
        result.warnings.push(`referenced rule not found in regen-root: .claude/rules/${ref.name}`);
      }
    }
  }

  // Check 8: output contract banner
  if (!/OUTPUT CONTRACT/.test(fm.body)) {
    result.warnings.push("body missing OUTPUT CONTRACT banner (guides/output-contract.md reference)");
  }

  return result;
}

function auditAgentGuide(filepath) {
  const filename = basename(filepath);
  const result = { file: filename, name: filename, errors: [], warnings: [] };
  let text;
  try {
    text = readFileSync(filepath, "utf8");
  } catch (e) {
    result.errors.push(`cannot read file: ${e.message}`);
    return result;
  }
  if (text.replace(/\r\n/g, "\n").startsWith("---\n")) {
    result.errors.push("agent guide still has frontmatter — should be plain markdown");
  }
  if (!/OUTPUT CONTRACT/.test(text)) {
    result.warnings.push("body missing OUTPUT CONTRACT banner");
  }
  if (text.trim().length === 0) {
    result.errors.push("file is empty");
  }
  return result;
}

function main() {
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

  // Agent guides pass — scan guides/agents/*.md
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

  const fail =
    failed.length > 0 ||
    agentFailed.length > 0 ||
    (STRICT && (warned.length > 0 || agentWarned.length > 0));

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
            verdict: fail ? "FAIL" : "PASS",
          },
          results,
          agent_guides: {
            total: agentResults.length,
            failed: agentFailed.length,
            warned: agentWarned.length,
            clean: agentClean.length,
            results: agentResults,
          },
        },
        null,
        2,
      ),
    );
  } else {
    const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
    console.log("\nrdc-skills self-test — Tier 1 (static lint)\n");
    console.log(pad("skill", 24) + pad("status", 10) + "notes");
    console.log("─".repeat(80));
    for (const r of results) {
      const status = r.errors.length > 0 ? "FAIL" : r.warnings.length > 0 ? "WARN" : "pass";
      const notes = r.errors.length > 0 ? r.errors[0] : r.warnings[0] || "";
      console.log(pad(r.name || r.file, 24) + pad(status, 10) + notes);
      // Extra lines for additional issues
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

    console.log(`\nverdict: ${fail ? "❌ FAIL" : "✓ PASS"}${STRICT ? " (strict)" : ""}\n`);
  }

  process.exit(fail ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error(`FATAL: ${e.stack || e.message}`);
  process.exit(2);
}
