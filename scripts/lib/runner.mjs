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
import { join, dirname } from "node:path";
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

// work_items delta is only meaningful if we have a Supabase branch connection.
// We accept a `supabaseBranchRef` hint for future wiring. For now, when unset,
// we return an empty delta — assertions on work_items will see zero rows. This
// keeps the runner functional in environments without a branch (e.g. dry-run).
async function fetchWorkItemsDelta(_supabaseBranchRef, _snapshotCount) {
  return [];
}

async function fetchWorkItemsCount(_supabaseBranchRef) {
  return 0;
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
