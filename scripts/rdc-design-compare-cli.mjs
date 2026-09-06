#!/usr/bin/env node
// rdc-design-compare-cli.mjs — dispatches the SAME design brief to a Claude-side
// pass and a Codex-side pass, in parallel, and writes both raw outputs plus a
// machine-readable report. This is the real dispatch mechanism behind
// `rdc:design compare` / `--compare` (see skills/design/SKILL.md §Design Compare).
//
// It reuses the fleet's existing dual-engine spawn pattern — the same one
// scripts/lib/runner.mjs already uses to run `claude --print` and
// `codex exec --json` against a prompt for skill acceptance tests, and the
// same read-only-sandbox shape CDE's codex-cli-implementor.ts uses for a
// fresh planning turn (`codex exec --sandbox read-only --json <prompt>`).
//
// Both engines are told explicitly this is a proposal-only pass; the Codex
// side additionally enforces that at the sandbox level (`--sandbox read-only`),
// not just by prompt instruction. Neither side is expected to mutate files.
//
// The script does NOT synthesize the comparison itself — it hands both raw
// outputs to the calling agent, which reads claude.md + codex.md and writes
// the structured comparison table per skills/design/SKILL.md. A script
// diffing two paragraphs of prose cannot judge design tradeoffs; an agent can.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnHiddenShell } from "./lib/runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const skillRoot = join(repoRoot, "skills", "design");
const reportsRoot = join(repoRoot, ".rdc", "reports", "rdc-design-cli");

const DEFAULT_TIMEOUT_MS = Number(process.env.RDC_DESIGN_COMPARE_TIMEOUT_MS ?? "240000");

const commandRefs = {
  studio: ["studio-model", "ownership"],
  tokens: ["studio-model", "ownership"],
  palette: ["studio-model", "rampa", "ownership"],
  theme: ["studio-model", "rampa", "ownership"],
  colorize: ["rampa", "studio-model", "ownership"],
  audit: ["studio-model", "ownership"],
  critique: ["studio-model", "ownership"],
  polish: ["studio-model", "ownership"],
  craft: ["studio-model", "rampa", "ownership"],
  prototype: ["studio-model", "rampa", "ownership"],
};

function parseArgs(argv) {
  const out = { json: false, out: null, command: "craft", rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { out.json = true; continue; }
    if (a === "--out") { out.out = argv[++i]; continue; }
    if (a === "--command") { out.command = argv[++i]; continue; }
    out.rest.push(a);
  }
  return out;
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function loadReferences(names) {
  return names.map((name) => {
    const path = join(skillRoot, "reference", `${name}.md`);
    if (!existsSync(path)) throw new Error(`Missing reference: ${path}`);
    return { name, path, text: readText(path) };
  });
}

function buildDesignPrompt(brief, command) {
  const skillPath = join(skillRoot, "SKILL.md");
  if (!existsSync(skillPath)) throw new Error(`Missing skill file: ${skillPath}`);
  const refs = loadReferences(commandRefs[command] || commandRefs.craft);
  const skill = stripFrontmatter(readText(skillPath));
  const refText = refs.map((ref) => `## Reference: ${ref.name}\n\n${ref.text}`).join("\n\n");

  return [
    "# rdc:design Compare — Independent Design Proposal Pass",
    "",
    `Brief: ${brief}`,
    "",
    "## Operating Instructions",
    "",
    skill,
    "",
    refText,
    "",
    "## Your Task",
    "",
    `Produce an independent design proposal for: ${brief}`,
    "",
    "This is a READ-ONLY proposal pass. Do NOT create, edit, or delete any files, and do not",
    "run any command that mutates the working tree. Respond with a single written design",
    "proposal covering, at minimum: the dominant visual object, information hierarchy,",
    "interaction model, responsive transformation, semantic color / token approach, and",
    "named tradeoffs. Cite real existing tokens, components, or routes where relevant rather",
    "than inventing generic ones.",
  ].join("\n");
}

function extractClaudeFinalText(stdout) {
  let lastAssistantText = "";
  let resultText = "";
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue; // a non-JSON transport line is not a provider transcript to retain
    }
    if (evt.type === "assistant" && Array.isArray(evt.message?.content)) {
      const text = evt.message.content
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n");
      if (text) lastAssistantText = text;
    }
    if (evt.type === "result" && typeof evt.result === "string") {
      resultText = evt.result;
    }
  }
  return resultText || lastAssistantText || stdout.trim();
}

function extractCodexFinalText(stdout) {
  let final = "";
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (evt.item?.type === "agent_message" && typeof evt.item.text === "string") final = evt.item.text;
  }
  return final || stdout.trim();
}

async function main() {
  const { json, out, command, rest } = parseArgs(process.argv.slice(2));
  const brief = rest.join(" ").trim();

  if (!brief) {
    console.error(
      'rdc-design-compare-cli: a design brief is required, e.g.\n  node scripts/rdc-design-compare-cli.mjs "dashboard hero panel for a stewardship dashboard"',
    );
    process.exit(1);
    return;
  }

  const prompt = buildDesignPrompt(brief, command);
  const claudeBin = process.env.CLAUDE_BIN || "claude";
  const codexBin = process.env.CODEX_BIN || "codex";
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const env = { ...process.env, RDC_TEST: process.env.RDC_TEST ?? "1" };

  // The assembled prompt (SKILL.md + references) routinely exceeds Windows' ~8191-char
  // command-line length limit, so it is NEVER passed as an argv element — both engines
  // read it from stdin instead (both support this; verified live against codex-cli 0.146.0
  // and claude-code 2.1.233 on this box before this script shipped).
  //
  // Claude side: no positional prompt arg, no --dangerously-skip-permissions. A
  // non-interactive --print run with no approved tool grants naturally cannot mutate
  // files; the prompt also says not to. cwd = repo root so it can cite real
  // tokens/components if asked.
  const claudeArgs = ["--print", "--output-format", "stream-json", "--verbose"];

  // Codex side: explicit "-" reads the prompt from stdin. Read-only sandbox is a
  // technical enforcement, not just a prompt instruction — mirrors CDE's
  // readOnlyPlanningArgs in codex-cli-implementor.ts.
  const codexArgs = ["exec", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only", "--json", "-"];

  const [claudeRes, codexRes] = await Promise.all([
    spawnHiddenShell(claudeBin, claudeArgs, { cwd: repoRoot, env, timeoutMs, stdin: prompt }),
    spawnHiddenShell(codexBin, codexArgs, { cwd: repoRoot, env, timeoutMs, stdin: prompt }),
  ]);

  const claudeOk = claudeRes.exit === 0 && !claudeRes.timedOut;
  const codexOk = codexRes.exit === 0 && !codexRes.timedOut;
  const claudeText = claudeOk ? extractClaudeFinalText(claudeRes.stdout) : "";
  const codexText = codexOk ? extractCodexFinalText(codexRes.stdout) : "";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = out ? resolve(out) : join(reportsRoot, `compare-${stamp}`);
  mkdirSync(dir, { recursive: true });

  const claudePath = join(dir, "claude.md");
  const codexPath = join(dir, "codex.md");
  const reportPath = join(dir, "report.json");

  writeFileSync(claudePath, claudeText || "(no output — see report.json for exit code / stderr)\n");
  writeFileSync(codexPath, codexText || "(no output — see report.json for exit code / stderr)\n");

  const report = {
    brief,
    command,
    generated_at: new Date().toISOString(),
    claude: {
      ok: claudeOk,
      exit: claudeRes.exit,
      timed_out: claudeRes.timedOut,
      stderr: claudeRes.stderr.slice(0, 4000),
      chars: claudeText.length,
    },
    codex: {
      ok: codexOk,
      exit: codexRes.exit,
      timed_out: codexRes.timedOut,
      stderr: codexRes.stderr.slice(0, 4000),
      chars: codexText.length,
    },
    paths: { dir, claude_md: claudePath, codex_md: codexPath, report_json: reportPath },
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("rdc-design-compare-cli");
    console.log(`brief: ${brief}`);
    console.log(
      `claude: ${claudeOk ? "ok" : `FAILED (exit ${claudeRes.exit}${claudeRes.timedOut ? ", timed out" : ""})`} — ${claudeText.length} chars`,
    );
    console.log(
      `codex:  ${codexOk ? "ok" : `FAILED (exit ${codexRes.exit}${codexRes.timedOut ? ", timed out" : ""})`} — ${codexText.length} chars`,
    );
    console.log(`report: ${reportPath}`);
    console.log(`claude.md: ${claudePath}`);
    console.log(`codex.md: ${codexPath}`);
    if (!claudeOk && !codexOk) {
      console.log("Both engines failed — nothing to compare. See report.json for stderr.");
    } else if (!codexOk) {
      console.log("Codex unreachable/failed — single-engine (Claude) result only. Report this; do not fabricate a second opinion.");
    } else if (!claudeOk) {
      console.log("Claude side failed — single-engine (Codex) result only. Report this; do not fabricate a second opinion.");
    }
  }

  // Non-zero only when BOTH engines failed — a single-engine fallback is a
  // reportable degraded result, not a hard failure of the compare tool itself.
  process.exit(claudeOk || codexOk ? 0 : 1);
}

main().catch((error) => {
  console.error(`rdc-design-compare-cli error: ${error.message}`);
  process.exit(1);
});
