#!/usr/bin/env node
// self-test-ui.mjs — Interactive menu for the RDC skills test runner
//
// Usage:
//   node scripts/self-test-ui.mjs
//
// Shows a numbered menu, takes keyboard input, then spawns self-test.mjs
// with the right flags. Test output streams live to the same terminal
// (stdio: 'inherit') — you see results in real time alongside the Claude Code session.
//
// No server, no HTTP, no extra processes at rest. Pure Node.js readline.

import readline from "node:readline";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const SELF_TEST = join(__dirname, "self-test.mjs");

// ── Helpers ────────────────────────────────────────────────────────────────

function getSkillNames() {
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.startsWith("rdc-") && f.endsWith(".md"))
    .map((f) => "rdc:" + f.replace(/^rdc-/, "").replace(/\.md$/, ""))
    .sort();
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function runTest(args) {
  return new Promise((resolve) => {
    console.log(
      `\n${"─".repeat(50)}\n▶  node self-test.mjs ${args.join(" ")}\n${"─".repeat(50)}\n`
    );
    const proc = spawn("node", [SELF_TEST, ...args], { stdio: "inherit" });
    proc.on("exit", (code) => resolve(code ?? 0));
  });
}

// ── Menu screens ───────────────────────────────────────────────────────────

function printMain() {
  console.clear();
  console.log(`
╔══════════════════════════════════════════════════╗
║          RDC Skills Test Runner                  ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  1  Full test — all skills, Tier 1               ║
║  2  Pick a specific skill to test                ║
║  3  Select tier (Tier 1 | Tier 2)                ║
║                                                  ║
║  q  Quit                                         ║
║                                                  ║
╚══════════════════════════════════════════════════╝
`);
}

async function pickSkill(rl) {
  const skills = getSkillNames();
  console.log("\nAvailable skills:\n");
  skills.forEach((s, i) => {
    const idx = String(i + 1).padStart(2, " ");
    console.log(`  ${idx}.  ${s}`);
  });
  console.log();

  const raw = await ask(rl, "Enter number or skill name (e.g. rdc:build): ");
  const n = parseInt(raw.trim(), 10);

  if (!isNaN(n) && n >= 1 && n <= skills.length) {
    return skills[n - 1];
  }

  // Accept bare name (rdc:build) or canonical (rdc-build)
  const normalised = raw.trim().startsWith("rdc:")
    ? raw.trim()
    : `rdc:${raw.trim().replace(/^rdc-/, "")}`;

  if (skills.includes(normalised)) return normalised;

  console.error(`\n✗  Unknown skill: "${raw.trim()}"\n`);
  return null;
}

async function pickTier(rl) {
  console.log(`
  Tiers:
    1  Tier 1 — static lint (fast, no network)
    2  Tier 2 — behavioral runner (spawns agents, Supabase sandbox)
    3  Tier 3 — golden snapshot regression (🔒 future, not yet implemented)
`);
  const t = await ask(rl, "Which tier? [1/2]: ");
  return t.trim();
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Cleanup on Ctrl+C
  rl.on("SIGINT", () => {
    console.log("\n\nAborted.");
    rl.close();
    process.exit(0);
  });

  printMain();
  const choice = (await ask(rl, "Choose [1/2/3/q]: ")).trim().toLowerCase();

  if (choice === "q") {
    rl.close();
    console.log("Bye.\n");
    return;
  }

  if (choice === "1") {
    rl.close();
    const code = await runTest([]);
    process.exit(code);
  }

  if (choice === "2") {
    const skill = await pickSkill(rl);
    rl.close();
    if (!skill) process.exit(1);
    const code = await runTest(["--skill", skill]);
    process.exit(code);
  }

  if (choice === "3") {
    const tier = await pickTier(rl);
    rl.close();

    if (tier === "1") {
      const code = await runTest([]);
      process.exit(code);
    }
    if (tier === "2") {
      const code = await runTest(["--tier2"]);
      process.exit(code);
    }
    if (tier === "3") {
      console.error(
        "\n⚠️  Tier 3 (golden snapshot regression) is not yet implemented.\n"
      );
      process.exit(3);
    }

    console.error(`\n✗  Unknown tier: "${tier}"\n`);
    rl.close();
    process.exit(1);
  }

  rl.close();
  console.error(`\n✗  Unknown choice: "${choice}"\n`);
  process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
