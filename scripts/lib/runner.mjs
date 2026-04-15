// runner.mjs — Tier 2 per-skill test orchestration.
//
// Public API:
//   runManifest(manifest, { runId, supabaseBranchRef?, timeout?, claudeBin? })
//     → { skill, pass, duration_ms, observed?, failures?, error? }
//
// Flow per manifest:
//   1. Create a worktree at .rdc-sandbox/<runId>/<skill-slug>/
//   2. Write precondition_files into the worktree
//   3. Snapshot HEAD sha + work_items rowcount (via Supabase branch if given)
//   4. Spawn `claude --print "<prompt>" --output-format stream-json`
//      - cwd = worktree
//      - env = { ...process.env, ...fixture.env, RDC_TEST: "1" }
//      - timeout kills the child on overrun
//   5. Compute observed delta: commits since snapshot, files changed, work_items delta
//   6. Call evaluateAssertions
//   7. Return structured result — never throws (caller-friendly).
//
// Cleanup is the caller's responsibility (runner does NOT remove the worktree,
// so the caller can inspect on failure before teardown).

import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorktree } from "./sandbox.mjs";
import { evaluateAssertions } from "./assertions.mjs";

const DEFAULT_TIMEOUT_MS = 120_000;

function nowMs() {
  return Date.now();
}

/** Run a git command inside `cwd`, return trimmed stdout or "". Never throws. */
function gitIn(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function snapshotHead(cwd) {
  return gitIn(cwd, ["rev-parse", "HEAD"]);
}

function commitsSince(cwd, baseSha) {
  if (!baseSha) return [];
  const out = gitIn(cwd, ["log", `${baseSha}..HEAD`, "--pretty=format:%H%x1f%s%x1f%b%x1e"]);
  if (!out) return [];
  return out
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split("\x1f");
      return { sha: sha || "", subject: subject || "", body: body || "" };
    });
}

function filesModifiedSince(cwd, baseSha) {
  if (!baseSha) return [];
  const tracked = gitIn(cwd, ["diff", "--name-only", `${baseSha}..HEAD`]);
  const untracked = gitIn(cwd, ["ls-files", "--others", "--exclude-standard"]);
  const set = new Set();
  for (const line of (tracked + "\n" + untracked).split(/\r?\n/)) {
    const p = line.trim();
    if (p) set.add(p.replace(/\\/g, "/"));
  }
  return [...set];
}

function writePreconditionFiles(worktreePath, files) {
  if (!Array.isArray(files)) return;
  for (const pf of files) {
    if (!pf || typeof pf.path !== "string") continue;
    const abs = join(worktreePath, pf.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof pf.content === "string" ? pf.content : "");
  }
}

/** Spawn `claude --print ...` with a hard timeout. Resolves to {exit, stdout, stderr, timedOut}. */
function spawnClaude({ claudeBin, prompt, cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(
        claudeBin,
        ["--print", prompt, "--output-format", "stream-json"],
        { cwd, env, shell: false, windowsHide: true },
      );
    } catch (e) {
      resolve({ exit: -1, stdout: "", stderr: `spawn failed: ${e.message}`, timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGKILL"); } catch {}
      settled = true;
      resolve({ exit: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({ exit: -1, stdout, stderr: stderr + `\nspawn error: ${e.message}`, timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({ exit: code == null ? -1 : code, stdout, stderr, timedOut: false });
    });
  });
}

// ─── work_items fetch (live) ────────────────────────────────────────────────
//
// These helpers talk to the Supabase PostgREST endpoint on the branch created
// by sandbox.createSupabaseTestBranch. They never throw — on any error (missing
// creds, network, bad response) they log a one-line warning and return a safe
// empty value so the runner degrades gracefully in environments without a
// live branch.
//
// supabaseBranchRef shape: { branchId, connectionString, apiUrl, anonKey }

/** Parse a PostgREST Content-Range header like "0-0/42" → 42. "*\/0" → 0. */
export function parseContentRange(header) {
  if (typeof header !== "string" || header.length === 0) return 0;
  const m = header.match(/\/(\d+|\*)\s*$/);
  if (!m) return 0;
  if (m[1] === "*") return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

function hasBranchCreds(ref) {
  return !!(ref && typeof ref === "object" && ref.apiUrl && ref.anonKey);
}

export async function fetchWorkItemsCount(supabaseBranchRef) {
  if (!hasBranchCreds(supabaseBranchRef)) {
    if (supabaseBranchRef) {
      console.error(
        "fetchWorkItemsCount: supabaseBranchRef missing apiUrl/anonKey — returning 0",
      );
    }
    return 0;
  }
  const { apiUrl, anonKey } = supabaseBranchRef;
  try {
    const res = await fetch(`${apiUrl}/rest/v1/work_items?select=id`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Prefer: "count=exact",
        Range: "0-0",
        "Range-Unit": "items",
      },
    });
    if (!res.ok && res.status !== 206) {
      console.error(
        `fetchWorkItemsCount: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
      return 0;
    }
    const cr = res.headers.get("content-range") || res.headers.get("Content-Range");
    return parseContentRange(cr || "");
  } catch (e) {
    console.error(`fetchWorkItemsCount: ${e.message}`);
    return 0;
  }
}

/**
 * Fetch metadata for the N newest work_items created since the snapshot.
 * Returns an array of { id, status, labels } (matching the shape consumed by
 * assertions.checkWorkItemsCreated). Never throws.
 */
export async function fetchWorkItemsDelta(supabaseBranchRef, snapshotCount) {
  if (!hasBranchCreds(supabaseBranchRef)) return [];
  const currentCount = await fetchWorkItemsCount(supabaseBranchRef);
  const delta = currentCount - (Number(snapshotCount) || 0);
  if (delta <= 0) return [];

  const { apiUrl, anonKey } = supabaseBranchRef;
  try {
    const url =
      `${apiUrl}/rest/v1/work_items` +
      `?select=id,status,labels&order=created_at.desc&limit=${delta}`;
    const res = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });
    if (!res.ok) {
      console.error(
        `fetchWorkItemsDelta: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
      return [];
    }
    const body = await res.json();
    if (!Array.isArray(body)) return [];
    return body.map((wi) => ({
      id: wi?.id,
      status: wi?.status,
      labels: Array.isArray(wi?.labels) ? wi.labels : [],
    }));
  } catch (e) {
    console.error(`fetchWorkItemsDelta: ${e.message}`);
    return [];
  }
}

export async function runManifest(manifest, opts = {}) {
  const started = nowMs();
  const skill = manifest?.skill || "<unknown>";
  const {
    runId,
    supabaseBranchRef = null,
    timeout = DEFAULT_TIMEOUT_MS,
    claudeBin = process.env.CLAUDE_BIN || "claude",
  } = opts;

  if (!runId) {
    return { skill, pass: false, duration_ms: 0, error: "runManifest: runId is required" };
  }

  let worktree;
  try {
    worktree = createWorktree(runId, skill);
  } catch (e) {
    return { skill, pass: false, duration_ms: nowMs() - started, error: `worktree: ${e.message}` };
  }

  try {
    writePreconditionFiles(worktree.path, manifest.fixture?.precondition_files);
  } catch (e) {
    return { skill, pass: false, duration_ms: nowMs() - started, error: `precondition_files: ${e.message}` };
  }

  // Commit precondition files so HEAD snapshot is stable
  try {
    gitIn(worktree.path, ["add", "-A"]);
    const status = gitIn(worktree.path, ["status", "--porcelain"]);
    if (status) {
      execFileSync("git", ["-c", "user.email=test@rdc", "-c", "user.name=rdc-test", "commit", "-m", "test: precondition"], {
        cwd: worktree.path,
        stdio: "ignore",
      });
    }
  } catch {
    // non-fatal — snapshot will still work against whatever HEAD is
  }

  const headBefore = snapshotHead(worktree.path);
  const wiCountBefore = await fetchWorkItemsCount(supabaseBranchRef);

  const env = {
    ...process.env,
    ...(manifest.fixture?.env || {}),
    RDC_TEST: "1",
  };

  let spawnRes;
  try {
    spawnRes = await spawnClaude({
      claudeBin,
      prompt: manifest.fixture?.prompt || "",
      cwd: worktree.path,
      env,
      timeoutMs: timeout,
    });
  } catch (e) {
    return {
      skill,
      pass: false,
      duration_ms: nowMs() - started,
      error: `spawn claude: ${e.message}`,
    };
  }

  const commits = commitsSince(worktree.path, headBefore);
  const files_modified = filesModifiedSince(worktree.path, headBefore);
  const work_items_delta = await fetchWorkItemsDelta(supabaseBranchRef, wiCountBefore);

  const observed = {
    exit_code: spawnRes.exit,
    stdout: spawnRes.stdout,
    stderr: spawnRes.stderr,
    files_modified,
    commits,
    work_items_delta,
    timed_out: spawnRes.timedOut,
  };

  const evalRes = evaluateAssertions(manifest.assertions || {}, observed);
  let pass = evalRes.pass;
  const failures = [...evalRes.failures];
  if (spawnRes.timedOut) {
    pass = false;
    failures.unshift({ predicate: "timeout", message: `child killed after ${timeout}ms` });
  }

  return {
    skill,
    pass,
    duration_ms: nowMs() - started,
    observed,
    failures,
    worktree: worktree.path,
  };
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
  let passed = 0;
  let total = 0;
  function t(desc, ok) {
    total++;
    if (ok) passed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${desc}`);
  }

  console.log("\nrunner.mjs self-test\n");

  // parseContentRange
  t("parseContentRange '0-0/42' → 42", parseContentRange("0-0/42") === 42);
  t("parseContentRange '0-0/0' → 0", parseContentRange("0-0/0") === 0);
  t("parseContentRange '*/0' → 0", parseContentRange("*/0") === 0);
  t("parseContentRange '0-24/100' → 100", parseContentRange("0-24/100") === 100);
  t("parseContentRange '' → 0", parseContentRange("") === 0);
  t("parseContentRange null → 0", parseContentRange(null) === 0);
  t("parseContentRange 'garbage' → 0", parseContentRange("garbage") === 0);

  // fetch helpers graceful-degrade path
  (async () => {
    const c0 = await fetchWorkItemsCount(null);
    t("fetchWorkItemsCount(null) → 0", c0 === 0);
    const c1 = await fetchWorkItemsCount({ branchId: "x" }); // missing apiUrl/anonKey
    t("fetchWorkItemsCount(no-creds) → 0", c1 === 0);
    const d0 = await fetchWorkItemsDelta(null, 0);
    t(
      "fetchWorkItemsDelta(null, 0) → []",
      Array.isArray(d0) && d0.length === 0,
    );

    // evaluateAssertions with observed work_items_delta matching manifest
    const observed = {
      exit_code: 0,
      stdout: "",
      stderr: "",
      files_modified: [],
      commits: [],
      work_items_delta: [{ id: "w1", status: "done", labels: ["fixit"] }],
      timed_out: false,
    };
    const r = evaluateAssertions(
      {
        exit_code: 0,
        work_items_created: {
          min: 1,
          max: 1,
          status: "done",
          labels_include: ["fixit"],
        },
      },
      observed,
    );
    t("evaluateAssertions: matching work_items → pass", r.pass === true);

    const r2 = evaluateAssertions(
      {
        work_items_created: { min: 1, labels_include: ["missing"] },
      },
      observed,
    );
    t(
      "evaluateAssertions: label mismatch → fail",
      r2.pass === false &&
        r2.failures.some((f) => f.predicate === "work_items_created"),
    );

    console.log(`\n${passed}/${total} passed\n`);
    process.exit(passed === total ? 0 : 1);
  })();
}
