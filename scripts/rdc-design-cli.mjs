#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const skillRoot = join(repoRoot, "skills", "design");
const reportsRoot = join(repoRoot, ".rdc", "reports", "rdc-design-cli");

const args = process.argv.slice(2);
const json = args.includes("--json");
const cleanArgs = args.filter((arg) => arg !== "--json");
const command = cleanArgs[0] || "help";
const brief = cleanArgs.slice(1).join(" ").trim();

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
  help: ["ownership"],
};

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function approxTokens(text) {
  return Math.ceil(text.length / 4);
}

function wordCount(text) {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function loadReferences(names) {
  return names.map((name) => {
    const path = join(skillRoot, "reference", `${name}.md`);
    if (!existsSync(path)) throw new Error(`Missing reference: ${path}`);
    return { name, path, text: readText(path) };
  });
}

function buildPrompt() {
  const skillPath = join(skillRoot, "SKILL.md");
  if (!existsSync(skillPath)) throw new Error(`Missing skill file: ${skillPath}`);

  const refs = loadReferences(commandRefs[command] || ["studio-model", "ownership"]);
  const skill = stripFrontmatter(readText(skillPath));
  const refText = refs.map((ref) => `## Reference: ${ref.name}\n\n${ref.text}`).join("\n\n");
  const target = brief || "(no brief supplied)";

  const prompt = [
    "# rdc:design CLI Prompt",
    "",
    `Command: ${command}`,
    `Brief: ${target}`,
    "",
    "## Operating Instructions",
    "",
    skill,
    "",
    refText,
    "",
    "## User Task",
    "",
    `Execute \`rdc:design ${command}\` for: ${target}`,
    "",
    "Return checklist-first output, cite concrete Studio files/routes/tables when relevant, and do not mutate unrelated installed skills or vendor artifacts.",
  ].join("\n");

  return { prompt, refs };
}

function writeReport(report) {
  mkdirSync(reportsRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = join(reportsRoot, `${stamp}-${command}`);
  writeFileSync(`${base}.txt`, report.prompt);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  return { textPath: `${base}.txt`, jsonPath: `${base}.json` };
}

try {
  const { prompt, refs } = buildPrompt();
  const report = {
    command,
    brief,
    generated_at: new Date().toISOString(),
    references: refs.map((ref) => ({
      name: ref.name,
      path: ref.path,
      chars: ref.text.length,
      words: wordCount(ref.text),
      approx_tokens: approxTokens(ref.text),
    })),
    totals: {
      chars: prompt.length,
      words: wordCount(prompt),
      approx_tokens: approxTokens(prompt),
    },
    prompt,
  };
  const paths = writeReport(report);
  report.paths = paths;

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`rdc-design-cli`);
    console.log(`command: ${command}`);
    console.log(`brief: ${brief || "(none)"}`);
    console.log(`chars: ${report.totals.chars}`);
    console.log(`words: ${report.totals.words}`);
    console.log(`approx_tokens: ${report.totals.approx_tokens}`);
    console.log(`references: ${report.references.map((r) => r.name).join(", ")}`);
    console.log(`text: ${paths.textPath}`);
    console.log(`json: ${paths.jsonPath}`);
  }
} catch (error) {
  console.error(`rdc-design-cli error: ${error.message}`);
  process.exit(1);
}
