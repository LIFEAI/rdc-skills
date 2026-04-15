// sandbox.mjs — Tier 2 sandbox lifecycle primitives
//
// Provides isolated execution environments for rdc:* skill tests:
//   1. Git worktrees — one per skill per run, on throwaway `test/*` branches
//   2. Supabase test branches — one per run, shared across skills (budget)
//
// Consumers: scripts/self-test.mjs --tier2 (WP5, not yet written).
// This module is side-effect-free at import time. The self-test at the
// bottom exercises only pure helpers — no worktrees, no HTTP calls.
//
// See .rdc/plans/skill-self-test-tier-2.md (D1) for topology rationale.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SANDBOX_ROOT = join(REPO_ROOT, ".rdc-sandbox");
const SUPABASE_PROJECT_REF = "uvojezuorjgqzmhhgluu";
const SUPABASE_MGMT_API = "https://api.supabase.com";
const CLAUTH_URL = "http://127.0.0.1:52437";
const STALE_AGE_HOURS = 1;

// ---------- path helpers ----------

/** Forward-slash a path. Git accepts both on Windows; this keeps errors tidy. */
function fwd(p) {
  return p.replace(/\\/g, "/");
}

/** Normalize a skill name for use in a git branch. Git forbids ':'. */
function normalizeSkillForBranch(skillName) {
  return skillName.replace(/:/g, "-");
}

function worktreePath(runId, skillName) {
  return fwd(join(SANDBOX_ROOT, runId, normalizeSkillForBranch(skillName)));
}

function branchName(runId, skillName) {
  return `test/${normalizeSkillForBranch(skillName)}-${runId}`;
}

// ---------- shell ----------

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      cwd: REPO_ROOT,
      ...opts,
    });
  } catch (e) {
    const stderr = e.stderr?.toString?.() || "";
    const stdout = e.stdout?.toString?.() || "";
    const err = new Error(
      `command failed (exit ${e.status}): ${cmd}\nstderr: ${stderr.trim()}\nstdout: ${stdout.trim()}`,
    );
    err.exitCode = e.status;
    err.stderr = stderr;
    err.stdout = stdout;
    throw err;
  }
}

// ---------- sandbox root ----------

/** Create (if needed) and return the absolute sandbox root path. Idempotent. */
export function createSandboxRoot() {
  if (!existsSync(SANDBOX_ROOT)) {
    mkdirSync(SANDBOX_ROOT, { recursive: true });
  }
  return SANDBOX_ROOT;
}

/** Generate a run id: YYYY-MM-DD + 6 hex chars. */
export function generateRunId() {
  const d = new Date();
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const rand = randomBytes(3).toString("hex");
  return `${date}-${rand}`;
}

// ---------- git worktrees ----------

/** Create a new worktree on a throwaway branch. Throws if path already exists. */
export function createWorktree(runId, skillName) {
  createSandboxRoot();
  const path = worktreePath(runId, skillName);
  const branch = branchName(runId, skillName);
  if (existsSync(path)) {
    throw new Error(
      `worktree already exists for run=${runId} skill=${skillName} at ${path} — caller must decide retry policy`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  try {
    sh(`git worktree add "${path}" -b "${branch}"`);
  } catch (e) {
    throw new Error(
      `failed to create worktree for run=${runId} skill=${skillName}: ${e.message}`,
    );
  }
  return { path, branch };
}

/** Remove a worktree and its throwaway branch. Safe to call if already gone. */
export function removeWorktree(runId, skillName) {
  const path = worktreePath(runId, skillName);
  const branch = branchName(runId, skillName);
  if (existsSync(path)) {
    try {
      sh(`git worktree remove "${path}" --force`);
    } catch (e) {
      // fall through — try to prune + delete branch anyway
      try { sh(`git worktree prune`); } catch {}
    }
  }
  try {
    sh(`git branch -D "${branch}"`);
  } catch {
    // branch may already be gone or never created
  }
}

/** Scan .rdc-sandbox/ for worktree dirs older than STALE_AGE_HOURS. */
export function listStaleWorktrees() {
  const stale = [];
  if (!existsSync(SANDBOX_ROOT)) return stale;
  const now = Date.now();
  let runDirs;
  try {
    runDirs = readdirSync(SANDBOX_ROOT);
  } catch {
    return stale;
  }
  for (const runId of runDirs) {
    const runPath = join(SANDBOX_ROOT, runId);
    let st;
    try { st = statSync(runPath); } catch { continue; }
    if (!st.isDirectory()) continue;
    let skills;
    try { skills = readdirSync(runPath); } catch { continue; }
    for (const skill of skills) {
      const p = join(runPath, skill);
      let sst;
      try { sst = statSync(p); } catch { continue; }
      if (!sst.isDirectory()) continue;
      const ageHours = (now - sst.mtimeMs) / (1000 * 60 * 60);
      if (ageHours >= STALE_AGE_HOURS) {
        stale.push({
          path: fwd(p),
          branch: `test/${skill}-${runId}`,
          ageHours: Math.round(ageHours * 10) / 10,
        });
      }
    }
  }
  return stale;
}

/** Remove all stale worktrees. Returns count removed. Safe on-start call. */
export function cleanupStaleWorktrees() {
  const stale = listStaleWorktrees();
  let removed = 0;
  for (const w of stale) {
    try {
      sh(`git worktree remove "${w.path}" --force`);
      removed++;
    } catch (e) {
      console.error(`cleanup: failed to remove ${w.path}: ${e.message}`);
    }
    try { sh(`git branch -D "${w.branch}"`); } catch {}
  }
  try { sh(`git worktree prune`); } catch {}
  return removed;
}

// ---------- Supabase test branches ----------

async function getSupabaseMgmtToken() {
  const res = await fetch(`${CLAUTH_URL}/get/supabase-management`);
  if (!res.ok) {
    throw new Error(`clauth daemon returned ${res.status} fetching supabase-management token`);
  }
  const body = await res.text();
  // clauth returns raw secret or JSON {value:...}; handle both
  try {
    const j = JSON.parse(body);
    return j.value || j.secret || j.token || body.trim();
  } catch {
    return body.trim();
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Create a Supabase test branch via Management API.
 * Retries 3× with exponential backoff on 5xx. Throws on auth or final failure.
 */
export async function createSupabaseTestBranch(runId) {
  const token = await getSupabaseMgmtToken();
  const url = `${SUPABASE_MGMT_API}/v1/projects/${SUPABASE_PROJECT_REF}/branches`;
  const body = JSON.stringify({ branch_name: `test-${runId}` });

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body,
      });
    } catch (e) {
      lastErr = e;
      await sleep(500 * Math.pow(2, attempt - 1));
      continue;
    }
    if (res.ok) {
      const json = await res.json();
      return {
        branchId: json.id || json.branch_id,
        connectionString: json.database?.connection_string || json.connection_string || "",
      };
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Supabase branch create auth failed (${res.status}) for run=${runId}: ${await res.text()}`,
      );
    }
    if (res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status}: ${await res.text()}`);
      await sleep(500 * Math.pow(2, attempt - 1));
      continue;
    }
    // 4xx non-auth — permanent
    throw new Error(
      `Supabase branch create failed (${res.status}) for run=${runId}: ${await res.text()}`,
    );
  }
  throw new Error(
    `Supabase branch create failed after 3 retries for run=${runId}: ${lastErr?.message || "unknown"}`,
  );
}

/**
 * Delete a Supabase test branch. Swallows 404. Logs (non-fatal) on other errors.
 * Always safe to call.
 */
export async function deleteSupabaseTestBranch(branchId) {
  if (!branchId) return;
  let token;
  try {
    token = await getSupabaseMgmtToken();
  } catch (e) {
    console.error(`deleteSupabaseTestBranch: token fetch failed for branch=${branchId}: ${e.message}`);
    return;
  }
  const url = `${SUPABASE_MGMT_API}/v1/branches/${branchId}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    if (res.status === 404) return;
    if (!res.ok) {
      console.error(
        `deleteSupabaseTestBranch: branch=${branchId} HTTP ${res.status}: ${await res.text()}`,
      );
    }
  } catch (e) {
    console.error(`deleteSupabaseTestBranch: branch=${branchId} network error: ${e.message}`);
  }
}

// ---------- self-test ----------

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const runId = generateRunId();
  console.log(`runId: ${runId}`);
  const stale = listStaleWorktrees();
  console.log(`stale worktrees: ${stale.length}`);
  process.exit(0);
}
