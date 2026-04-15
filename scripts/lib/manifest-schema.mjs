// manifest-schema.mjs — Tier 2 test manifest schema + validator.
//
// Source of truth: .rdc/plans/skill-self-test-tier-2.md decision D3.
//
// A manifest describes one behavioral test for an rdc:* skill. The Tier 2
// runner loads a manifest, validates it here, then uses it to drive a headless
// Claude invocation inside a sandbox and assert on real artifacts.
//
// Exports:
//   MANIFEST_VERSION    — currently 1
//   validateManifest(obj)         → { ok, manifest, errors, warnings }
//   loadManifest(filepath)        → same shape, with io/parse errors
//   loadAllManifests(dir?)        → [{ file, ok, manifest?, errors?, warnings? }]
//
// Error shape: { path, code, msg }. `ok` is false iff errors.length > 0.
// Warnings (e.g. unknown-field) do not fail the manifest.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_VERSION = 1;

const VALID_STATUSES = new Set([
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
  "archived",
]);

const TOP_LEVEL_FIELDS = new Set([
  "manifest_version",
  "skill",
  "description",
  "fixture",
  "assertions",
  "teardown",
]);

const FIXTURE_FIELDS = new Set(["prompt", "precondition_files", "env"]);

const ASSERTION_FIELDS = new Set([
  "exit_code",
  "work_items_created",
  "files_modified",
  "commits_made",
  "stderr_empty",
  "stdout_contains",
]);

const WIC_FIELDS = new Set(["min", "max", "status", "labels_include"]);
const COMMITS_FIELDS = new Set(["min", "message_matches"]);
const TEARDOWN_FIELDS = new Set(["reset_branch"]);

const SKILL_RE = /^rdc:[a-z][a-z0-9-]*$/;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isInt(v) {
  return typeof v === "number" && Number.isInteger(v);
}

function isRelativePath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false; // Windows drive letter
  // Split on either slash and reject any '..' segment
  const parts = p.split(/[\\/]/);
  if (parts.some((seg) => seg === "..")) return false;
  return true;
}

function err(errors, path, code, msg) {
  errors.push({ path, code, msg });
}

function warn(warnings, path, code, msg) {
  warnings.push({ path, code, msg });
}

function validateFixture(fx, errors, warnings) {
  if (!isPlainObject(fx)) {
    err(errors, "fixture", "type", "fixture must be an object");
    return;
  }
  // prompt
  if (typeof fx.prompt !== "string" || fx.prompt.trim().length === 0) {
    err(errors, "fixture.prompt", "missing", "fixture.prompt must be a non-empty string");
  } else if (!fx.prompt.startsWith("rdc:")) {
    err(
      errors,
      "fixture.prompt",
      "prompt-not-rdc",
      `fixture.prompt must start with "rdc:" (got "${fx.prompt.slice(0, 20)}...")`,
    );
  }

  // precondition_files (optional, default [])
  if (fx.precondition_files !== undefined) {
    if (!Array.isArray(fx.precondition_files)) {
      err(
        errors,
        "fixture.precondition_files",
        "type",
        "precondition_files must be an array",
      );
    } else {
      fx.precondition_files.forEach((pf, i) => {
        const p = `fixture.precondition_files[${i}]`;
        if (!isPlainObject(pf)) {
          err(errors, p, "type", "precondition_file must be an object");
          return;
        }
        if (typeof pf.path !== "string" || pf.path.length === 0) {
          err(errors, `${p}.path`, "missing", "path must be a non-empty string");
        } else if (!isRelativePath(pf.path)) {
          err(
            errors,
            `${p}.path`,
            "path-not-relative",
            `path "${pf.path}" must be relative (no leading /, no .., no drive letter)`,
          );
        }
        if (typeof pf.content !== "string") {
          err(errors, `${p}.content`, "missing", "content must be a string");
        }
      });
    }
  }

  // env
  if (!isPlainObject(fx.env)) {
    err(errors, "fixture.env", "missing", "fixture.env must be an object");
  } else {
    if (fx.env.RDC_TEST !== "1") {
      err(
        errors,
        "fixture.env.RDC_TEST",
        "rdc-test-not-set",
        `fixture.env.RDC_TEST must be the literal string "1" (sandbox contract)`,
      );
    }
    for (const [k, v] of Object.entries(fx.env)) {
      if (typeof v !== "string") {
        err(
          errors,
          `fixture.env.${k}`,
          "type",
          `env var "${k}" must be a string (got ${typeof v})`,
        );
      }
    }
  }

  // unknown fields in fixture
  for (const k of Object.keys(fx)) {
    if (!FIXTURE_FIELDS.has(k)) {
      warn(warnings, `fixture.${k}`, "unknown-field", `unknown fixture field "${k}"`);
    }
  }
}

function validateWorkItems(wic, errors, warnings) {
  if (!isPlainObject(wic)) {
    err(errors, "assertions.work_items_created", "type", "must be an object");
    return;
  }
  let min, max;
  if (wic.min !== undefined) {
    if (!isInt(wic.min) || wic.min < 0) {
      err(
        errors,
        "assertions.work_items_created.min",
        "type",
        "min must be an integer >= 0",
      );
    } else {
      min = wic.min;
    }
  }
  if (wic.max !== undefined) {
    if (!isInt(wic.max) || wic.max < 0) {
      err(
        errors,
        "assertions.work_items_created.max",
        "type",
        "max must be an integer >= 0",
      );
    } else {
      max = wic.max;
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    err(
      errors,
      "assertions.work_items_created",
      "range-invalid",
      `min (${min}) must be <= max (${max})`,
    );
  }
  if (wic.status !== undefined) {
    if (typeof wic.status !== "string" || !VALID_STATUSES.has(wic.status)) {
      err(
        errors,
        "assertions.work_items_created.status",
        "status-invalid",
        `status must be one of: ${[...VALID_STATUSES].join(", ")}`,
      );
    }
  }
  if (wic.labels_include !== undefined) {
    if (!Array.isArray(wic.labels_include)) {
      err(
        errors,
        "assertions.work_items_created.labels_include",
        "type",
        "labels_include must be an array",
      );
    } else {
      wic.labels_include.forEach((lbl, i) => {
        if (typeof lbl !== "string") {
          err(
            errors,
            `assertions.work_items_created.labels_include[${i}]`,
            "type",
            "label must be a string",
          );
        }
      });
    }
  }
  for (const k of Object.keys(wic)) {
    if (!WIC_FIELDS.has(k)) {
      warn(
        warnings,
        `assertions.work_items_created.${k}`,
        "unknown-field",
        `unknown field "${k}"`,
      );
    }
  }
}

function validateCommits(cm, errors, warnings) {
  if (!isPlainObject(cm)) {
    err(errors, "assertions.commits_made", "type", "must be an object");
    return;
  }
  if (cm.min !== undefined && (!isInt(cm.min) || cm.min < 0)) {
    err(errors, "assertions.commits_made.min", "type", "min must be an integer >= 0");
  }
  if (cm.message_matches !== undefined) {
    if (typeof cm.message_matches !== "string") {
      err(
        errors,
        "assertions.commits_made.message_matches",
        "type",
        "message_matches must be a string (regex source)",
      );
    } else {
      try {
        new RegExp(cm.message_matches);
      } catch (e) {
        err(
          errors,
          "assertions.commits_made.message_matches",
          "invalid-regex",
          `invalid regex: ${e.message}`,
        );
      }
    }
  }
  for (const k of Object.keys(cm)) {
    if (!COMMITS_FIELDS.has(k)) {
      warn(warnings, `assertions.commits_made.${k}`, "unknown-field", `unknown field "${k}"`);
    }
  }
}

function validateAssertions(a, errors, warnings) {
  if (!isPlainObject(a)) {
    err(errors, "assertions", "type", "assertions must be an object");
    return;
  }
  if (Object.keys(a).length === 0) {
    warn(
      warnings,
      "assertions",
      "empty-assertions",
      "assertions object is empty — test will always pass",
    );
  }
  if (a.exit_code !== undefined) {
    if (!isInt(a.exit_code) || a.exit_code < 0) {
      err(errors, "assertions.exit_code", "type", "exit_code must be an integer >= 0");
    }
  }
  if (a.work_items_created !== undefined) {
    validateWorkItems(a.work_items_created, errors, warnings);
  }
  if (a.files_modified !== undefined) {
    if (!Array.isArray(a.files_modified)) {
      err(errors, "assertions.files_modified", "type", "files_modified must be an array");
    } else {
      a.files_modified.forEach((p, i) => {
        if (typeof p !== "string") {
          err(errors, `assertions.files_modified[${i}]`, "type", "path must be a string");
        } else if (!isRelativePath(p)) {
          err(
            errors,
            `assertions.files_modified[${i}]`,
            "path-not-relative",
            `path "${p}" must be relative`,
          );
        }
      });
    }
  }
  if (a.commits_made !== undefined) {
    validateCommits(a.commits_made, errors, warnings);
  }
  if (a.stderr_empty !== undefined && typeof a.stderr_empty !== "boolean") {
    err(errors, "assertions.stderr_empty", "type", "stderr_empty must be a boolean");
  }
  if (a.stdout_contains !== undefined) {
    if (!Array.isArray(a.stdout_contains)) {
      err(errors, "assertions.stdout_contains", "type", "stdout_contains must be an array");
    } else {
      a.stdout_contains.forEach((s, i) => {
        if (typeof s !== "string") {
          err(errors, `assertions.stdout_contains[${i}]`, "type", "entry must be a string");
        }
      });
    }
  }
  for (const k of Object.keys(a)) {
    if (!ASSERTION_FIELDS.has(k)) {
      warn(warnings, `assertions.${k}`, "unknown-field", `unknown assertion "${k}"`);
    }
  }
}

function validateTeardown(t, errors, warnings) {
  if (!isPlainObject(t)) {
    err(errors, "teardown", "type", "teardown must be an object");
    return;
  }
  if (t.reset_branch !== undefined && typeof t.reset_branch !== "boolean") {
    err(errors, "teardown.reset_branch", "type", "reset_branch must be a boolean");
  }
  for (const k of Object.keys(t)) {
    if (!TEARDOWN_FIELDS.has(k)) {
      warn(warnings, `teardown.${k}`, "unknown-field", `unknown teardown field "${k}"`);
    }
  }
}

export function validateManifest(raw) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      manifest: null,
      errors: [{ path: "", code: "type", msg: "manifest must be a JSON object" }],
      warnings: [],
    };
  }

  // manifest_version
  if (raw.manifest_version === undefined) {
    err(errors, "manifest_version", "missing", "manifest_version is required");
  } else if (!isInt(raw.manifest_version) || raw.manifest_version !== MANIFEST_VERSION) {
    err(
      errors,
      "manifest_version",
      "version-unsupported",
      `manifest_version must be ${MANIFEST_VERSION} (got ${JSON.stringify(raw.manifest_version)})`,
    );
  }

  // skill
  if (raw.skill === undefined) {
    err(errors, "skill", "missing", "skill is required");
  } else if (typeof raw.skill !== "string" || !SKILL_RE.test(raw.skill)) {
    err(
      errors,
      "skill",
      "skill-invalid",
      `skill must match /^rdc:[a-z][a-z0-9-]*$/ (got ${JSON.stringify(raw.skill)})`,
    );
  }

  // description
  if (raw.description === undefined) {
    err(errors, "description", "missing", "description is required");
  } else if (typeof raw.description !== "string" || raw.description.trim().length === 0) {
    err(errors, "description", "type", "description must be a non-empty string");
  }

  // fixture
  if (raw.fixture === undefined) {
    err(errors, "fixture", "missing", "fixture is required");
  } else {
    validateFixture(raw.fixture, errors, warnings);
  }

  // assertions
  if (raw.assertions === undefined) {
    err(errors, "assertions", "missing", "assertions is required");
  } else {
    validateAssertions(raw.assertions, errors, warnings);
  }

  // teardown (optional)
  if (raw.teardown !== undefined) {
    validateTeardown(raw.teardown, errors, warnings);
  }

  // unknown top-level fields → warning
  for (const k of Object.keys(raw)) {
    if (!TOP_LEVEL_FIELDS.has(k)) {
      warn(warnings, k, "unknown-field", `unknown top-level field "${k}"`);
    }
  }

  const ok = errors.length === 0;
  return { ok, manifest: ok ? raw : null, errors, warnings };
}

export function loadManifest(filepath) {
  let text;
  try {
    text = readFileSync(filepath, "utf8");
  } catch (e) {
    return {
      ok: false,
      manifest: null,
      errors: [{ path: "", code: "io", msg: `cannot read ${filepath}: ${e.message}` }],
      warnings: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      manifest: null,
      errors: [{ path: "", code: "parse", msg: `invalid JSON in ${filepath}: ${e.message}` }],
      warnings: [],
    };
  }
  return validateManifest(parsed);
}

export function loadAllManifests(dir) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = resolve(__dirname, "..", "..");
  const targetDir = dir || join(REPO_ROOT, "skills", "tests");
  if (!existsSync(targetDir)) return [];
  let files;
  try {
    files = readdirSync(targetDir).filter((f) => f.endsWith(".test.json"));
  } catch {
    return [];
  }
  return files.map((f) => {
    const full = join(targetDir, f);
    const res = loadManifest(full);
    return { file: `skills/tests/${basename(full)}`, ...res };
  });
}

// ─── Self-test ──────────────────────────────────────────────────────────────
const __isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
  } catch {
    return false;
  }
})();
if (__isMain) {
  const validMinimal = {
    manifest_version: 1,
    skill: "rdc:fixit",
    description: "minimal valid",
    fixture: {
      prompt: "rdc:fixit fix typo",
      env: { RDC_TEST: "1" },
    },
    assertions: { exit_code: 0 },
  };

  const cases = [
    {
      n: 1,
      desc: "valid minimal manifest",
      input: validMinimal,
      expect: (r) => r.ok && r.errors.length === 0 && r.warnings.length === 0,
      expectStr: "ok=true, 0 errors, 0 warnings",
    },
    {
      n: 2,
      desc: "missing skill",
      input: { ...validMinimal, skill: undefined },
      expect: (r) =>
        !r.ok && r.errors.some((e) => e.path === "skill" && e.code === "missing"),
      expectStr: "error code=missing on skill",
    },
    {
      n: 3,
      desc: "manifest_version: 2",
      input: { ...validMinimal, manifest_version: 2 },
      expect: (r) =>
        !r.ok && r.errors.some((e) => e.code === "version-unsupported"),
      expectStr: "error code=version-unsupported",
    },
    {
      n: 4,
      desc: 'fixture.env.RDC_TEST: "0"',
      input: {
        ...validMinimal,
        fixture: { ...validMinimal.fixture, env: { RDC_TEST: "0" } },
      },
      expect: (r) => !r.ok && r.errors.some((e) => e.code === "rdc-test-not-set"),
      expectStr: "error code=rdc-test-not-set",
    },
    {
      n: 5,
      desc: "invalid regex in commits_made.message_matches",
      input: {
        ...validMinimal,
        assertions: {
          exit_code: 0,
          commits_made: { min: 1, message_matches: "[unclosed" },
        },
      },
      expect: (r) => !r.ok && r.errors.some((e) => e.code === "invalid-regex"),
      expectStr: "error code=invalid-regex",
    },
    {
      n: 6,
      desc: "unknown top-level field `extra: 1`",
      input: { ...validMinimal, extra: 1 },
      expect: (r) =>
        r.ok &&
        r.warnings.length === 1 &&
        r.warnings[0].code === "unknown-field" &&
        r.warnings[0].path === "extra",
      expectStr: "ok=true, 1 warning code=unknown-field",
    },
    {
      n: 7,
      desc: "work_items_created.min > max",
      input: {
        ...validMinimal,
        assertions: {
          exit_code: 0,
          work_items_created: { min: 5, max: 2 },
        },
      },
      expect: (r) => !r.ok && r.errors.some((e) => e.code === "range-invalid"),
      expectStr: "error code=range-invalid",
    },
    {
      n: 8,
      desc: 'files_modified: ["/abs/path"]',
      input: {
        ...validMinimal,
        assertions: { exit_code: 0, files_modified: ["/abs/path"] },
      },
      expect: (r) => !r.ok && r.errors.some((e) => e.code === "path-not-relative"),
      expectStr: "error code=path-not-relative",
    },
  ];

  const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
  console.log("\nmanifest-schema self-test\n");
  console.log(pad("#", 3) + pad("description", 44) + pad("expected", 36) + pad("actual", 36) + "result");
  console.log("─".repeat(130));

  let passed = 0;
  for (const c of cases) {
    const r = validateManifest(c.input);
    const ok = c.expect(r);
    const actual = `ok=${r.ok}, ${r.errors.length}e/${r.warnings.length}w${
      r.errors[0] ? ` [${r.errors[0].code}]` : ""
    }${r.warnings[0] && r.errors.length === 0 ? ` [${r.warnings[0].code}]` : ""}`;
    console.log(
      pad(c.n, 3) +
        pad(c.desc, 44) +
        pad(c.expectStr, 36) +
        pad(actual, 36) +
        (ok ? "PASS" : "FAIL"),
    );
    if (ok) passed++;
  }
  console.log("─".repeat(130));
  console.log(`\n${passed}/${cases.length} passed\n`);
  process.exit(passed === cases.length ? 0 : 1);
}
