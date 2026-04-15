#!/usr/bin/env node
// watch-init.mjs — initialize a session log + viewer for rdc:watch.
//
// Usage:
//   node scripts/watch-init.mjs [--project-root <path>]
//
// Creates:
//   <projectRoot>/.rdc/session-log/<runId>.log    (with banner line)
//   <projectRoot>/.rdc/session-log/current.log    (copy of the new log)
//   <projectRoot>/.rdc/session-log/viewer.html    (copied from plugin assets)
//
// Exits 0 on success, 1 on error.

import { mkdirSync, writeFileSync, copyFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

function parseArgs(argv) {
  const out = { projectRoot: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project-root" && argv[i + 1]) {
      out.projectRoot = resolve(argv[++i]);
    }
  }
  return out;
}

function randId(n) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function makeRunId() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const stamp =
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  return stamp + "-" + randId(6);
}

function openHint(viewerPath) {
  const p = platform();
  if (p === "win32") return `start "" "${viewerPath}"`;
  if (p === "darwin") return `open "${viewerPath}"`;
  return `xdg-open "${viewerPath}"`;
}

function main() {
  const { projectRoot } = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));                    // .../rdc-skills/scripts
  const pluginRoot = resolve(here, "..");                                   // .../rdc-skills
  const assetViewer = join(pluginRoot, "assets", "watcher", "viewer.html");

  if (!existsSync(assetViewer)) {
    console.error(`watch-init: viewer asset missing at ${assetViewer}`);
    process.exit(1);
  }

  const logDir = join(projectRoot, ".rdc", "session-log");
  mkdirSync(logDir, { recursive: true });

  const runId = makeRunId();
  const logPath = join(logDir, `${runId}.log`);
  const currentPath = join(logDir, "current.log");
  const viewerPath = join(logDir, "viewer.html");

  const iso = new Date().toISOString();
  const banner = `[${iso}] [banner] Session started: ${runId}\n`;
  writeFileSync(logPath, banner, "utf8");
  writeFileSync(currentPath, banner, "utf8");

  // Copy viewer.html if missing or stale (source newer than dest).
  let needsCopy = !existsSync(viewerPath);
  if (!needsCopy) {
    try {
      const srcM = statSync(assetViewer).mtimeMs;
      const dstM = statSync(viewerPath).mtimeMs;
      if (srcM > dstM) needsCopy = true;
    } catch { needsCopy = true; }
  }
  if (needsCopy) copyFileSync(assetViewer, viewerPath);

  console.log("run_id:     " + runId);
  console.log("log_path:   " + logPath);
  console.log("current:    " + currentPath);
  console.log("viewer:     " + viewerPath);
  console.log("open_hint:  " + openHint(viewerPath));
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error("watch-init: " + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
