// assertions.mjs — Tier 2 declarative assertion evaluator.
//
// Consumed by scripts/lib/runner.mjs. Each predicate is a pure function
// (assertion, observed) => { pass, message } where observed is:
//   {
//     exit_code:         number,
//     stdout:            string,
//     stderr:            string,
//     files_modified:    string[],   // forward-slash relative paths
//     commits:           [{ sha, subject, body }],
//     work_items_delta:  [{ id, status, labels }],
//   }
//
// evaluateAssertions(manifest.assertions, observed) → { pass, failures[] }
// where failures is an array of { predicate, message } — empty iff pass.
//
// Self-test at the bottom; run `node scripts/lib/assertions.mjs`.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// ─── predicates ─────────────────────────────────────────────────────────────

export function checkExitCode(expected, observed) {
  if (expected === undefined) return { pass: true };
  if (observed.exit_code === expected) return { pass: true };
  return {
    pass: false,
    message: `exit_code expected ${expected}, got ${observed.exit_code}`,
  };
}

export function checkWorkItemsCreated(spec, observed) {
  if (spec === undefined) return { pass: true };
  const items = Array.isArray(observed.work_items_delta) ? observed.work_items_delta : [];
  let filtered = items;
  if (spec.status !== undefined) {
    filtered = filtered.filter((wi) => wi && wi.status === spec.status);
  }
  if (Array.isArray(spec.labels_include) && spec.labels_include.length > 0) {
    filtered = filtered.filter((wi) => {
      const labels = Array.isArray(wi?.labels) ? wi.labels : [];
      return spec.labels_include.every((lbl) => labels.includes(lbl));
    });
  }
  const count = filtered.length;
  if (spec.min !== undefined && count < spec.min) {
    return {
      pass: false,
      message: `work_items_created: expected >= ${spec.min} matching, got ${count}`,
    };
  }
  if (spec.max !== undefined && count > spec.max) {
    return {
      pass: false,
      message: `work_items_created: expected <= ${spec.max} matching, got ${count}`,
    };
  }
  return { pass: true };
}

export function checkFilesModified(expected, observed) {
  if (expected === undefined) return { pass: true };
  if (!Array.isArray(expected)) {
    return { pass: false, message: "files_modified assertion is not an array" };
  }
  const seen = new Set(
    (observed.files_modified || []).map((p) => String(p).replace(/\\/g, "/")),
  );
  const missing = expected.filter((p) => !seen.has(String(p).replace(/\\/g, "/")));
  if (missing.length === 0) return { pass: true };
  return {
    pass: false,
    message: `files_modified: missing from git diff: ${missing.join(", ")}`,
  };
}

export function checkCommitsMade(spec, observed) {
  if (spec === undefined) return { pass: true };
  const commits = Array.isArray(observed.commits) ? observed.commits : [];
  if (spec.min !== undefined && commits.length < spec.min) {
    return {
      pass: false,
      message: `commits_made: expected >= ${spec.min}, got ${commits.length}`,
    };
  }
  if (spec.message_matches !== undefined) {
    let re;
    try {
      re = new RegExp(spec.message_matches);
    } catch (e) {
      return { pass: false, message: `commits_made.message_matches invalid regex: ${e.message}` };
    }
    const hit = commits.some((c) => {
      const msg = `${c?.subject || ""}\n${c?.body || ""}`;
      return re.test(msg);
    });
    if (!hit) {
      return {
        pass: false,
        message: `commits_made.message_matches /${spec.message_matches}/ did not match any commit`,
      };
    }
  }
  return { pass: true };
}

export function checkStderrEmpty(expected, observed) {
  if (expected === undefined) return { pass: true };
  if (expected !== true) return { pass: true };
  const s = (observed.stderr || "").trim();
  if (s.length === 0) return { pass: true };
  const preview = s.length > 200 ? s.slice(0, 200) + "..." : s;
  return { pass: false, message: `stderr_empty: expected empty, got ${s.length} chars: ${preview}` };
}

export function checkStdoutContains(expected, observed) {
  if (expected === undefined) return { pass: true };
  if (!Array.isArray(expected)) {
    return { pass: false, message: "stdout_contains assertion is not an array" };
  }
  const stdout = observed.stdout || "";
  const missing = expected.filter((s) => !stdout.includes(s));
  if (missing.length === 0) return { pass: true };
  return {
    pass: false,
    message: `stdout_contains: missing substrings: ${missing.map((s) => JSON.stringify(s)).join(", ")}`,
  };
}

// ─── evaluator ──────────────────────────────────────────────────────────────

const PREDICATES = [
  ["exit_code", checkExitCode],
  ["work_items_created", checkWorkItemsCreated],
  ["files_modified", checkFilesModified],
  ["commits_made", checkCommitsMade],
  ["stderr_empty", checkStderrEmpty],
  ["stdout_contains", checkStdoutContains],
];

export function evaluateAssertions(assertions, observed) {
  const failures = [];
  if (assertions == null || typeof assertions !== "object") {
    return { pass: false, failures: [{ predicate: "", message: "assertions missing or not an object" }] };
  }
  for (const [key, fn] of PREDICATES) {
    const res = fn(assertions[key], observed || {});
    if (!res.pass) failures.push({ predicate: key, message: res.message });
  }
  return { pass: failures.length === 0, failures };
}

// ─── self-test ──────────────────────────────────────────────────────────────

const __isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
  } catch {
    return false;
  }
})();

if (__isMain) {
  const baseObserved = {
    exit_code: 0,
    stdout: "✓ done\nVerdict: PASS\n",
    stderr: "",
    files_modified: ["README.md", "src/foo.ts"],
    commits: [{ sha: "abc123", subject: "fix: typo in README", body: "" }],
    work_items_delta: [
      { id: "w1", status: "done", labels: ["fixit", "cs2"] },
      { id: "w2", status: "todo", labels: ["other"] },
    ],
  };

  const cases = [
    {
      n: 1,
      desc: "all predicates pass",
      assertions: {
        exit_code: 0,
        work_items_created: { min: 1, max: 1, status: "done", labels_include: ["fixit"] },
        files_modified: ["README.md"],
        commits_made: { min: 1, message_matches: "fix.*README" },
        stderr_empty: true,
        stdout_contains: ["✓", "Verdict:"],
      },
      observed: baseObserved,
      expect: (r) => r.pass && r.failures.length === 0,
    },
    {
      n: 2,
      desc: "exit_code mismatch",
      assertions: { exit_code: 1 },
      observed: baseObserved,
      expect: (r) => !r.pass && r.failures.some((f) => f.predicate === "exit_code"),
    },
    {
      n: 3,
      desc: "files_modified missing",
      assertions: { files_modified: ["CHANGELOG.md"] },
      observed: baseObserved,
      expect: (r) => !r.pass && r.failures.some((f) => f.predicate === "files_modified"),
    },
    {
      n: 4,
      desc: "commits_made regex no match",
      assertions: { commits_made: { message_matches: "^feat" } },
      observed: baseObserved,
      expect: (r) => !r.pass && r.failures.some((f) => f.predicate === "commits_made"),
    },
    {
      n: 5,
      desc: "stderr not empty",
      assertions: { stderr_empty: true },
      observed: { ...baseObserved, stderr: "warning: something" },
      expect: (r) => !r.pass && r.failures.some((f) => f.predicate === "stderr_empty"),
    },
    {
      n: 6,
      desc: "stdout_contains missing substring",
      assertions: { stdout_contains: ["NOTPRESENT"] },
      observed: baseObserved,
      expect: (r) => !r.pass && r.failures.some((f) => f.predicate === "stdout_contains"),
    },
    {
      n: 7,
      desc: "work_items_created label filter rejects",
      assertions: { work_items_created: { min: 1, labels_include: ["nonexistent"] } },
      observed: baseObserved,
      expect: (r) => !r.pass && r.failures.some((f) => f.predicate === "work_items_created"),
    },
    {
      n: 8,
      desc: "work_items_created max exceeded",
      assertions: { work_items_created: { max: 0 } },
      observed: baseObserved,
      expect: (r) => !r.pass && r.failures.some((f) => f.predicate === "work_items_created"),
    },
    {
      n: 9,
      desc: "empty assertions → pass",
      assertions: {},
      observed: baseObserved,
      expect: (r) => r.pass,
    },
  ];

  let passed = 0;
  console.log("\nassertions self-test\n");
  for (const c of cases) {
    const r = evaluateAssertions(c.assertions, c.observed);
    const ok = c.expect(r);
    console.log(
      `${String(c.n).padEnd(3)} ${c.desc.padEnd(44)} ${ok ? "PASS" : "FAIL"}${
        ok ? "" : "  → " + JSON.stringify(r.failures)
      }`,
    );
    if (ok) passed++;
  }
  console.log(`\n${passed}/${cases.length} passed\n`);
  process.exit(passed === cases.length ? 0 : 1);
}
