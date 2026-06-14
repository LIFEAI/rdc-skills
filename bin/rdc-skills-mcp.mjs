#!/usr/bin/env node
/**
 * bin/rdc-skills-mcp.mjs — local MCP server exposing the rdc-skills library.
 *
 * Mirrors the codeflow MCP topology (packages/codeflow/src/mcp/server.ts):
 *   express + @modelcontextprotocol/sdk McpServer + StreamableHTTPServerTransport,
 *   stateless (a fresh server+transport per POST /mcp), PORT from env.
 *
 * Routes:
 *   POST /mcp     — MCP over StreamableHTTP. NO Authorization (URL is the shared
 *                   secret, consistent with codeflow/clauth tunnel MCPs).
 *   GET  /health  — { status, service, version, skills } — no auth, no heavy work.
 *   /.well-known/* + /authorize + /token → 404 (force connectors to skip OAuth).
 *
 * It is tunneled in production at https://rdc-skills.regendevcorp.com/mcp; this
 * process only listens on PORT (default 3110) and does not configure the tunnel.
 *
 * ── Caller detection → variant (best-effort) ────────────────────────────────
 * Tools render a `cli` or `cloud` body. Detection rule: on MCP `initialize`,
 * `clientInfo.name` containing `claude-code` or `codex` → `cli`; anything else
 * (claude.ai web) → `cloud`; unknown → `cloud` (safer for web).
 *
 * APPROACH TAKEN — default + explicit override (NOT session-threaded):
 * The transport is stateless (a new McpServer per POST, sessionIdGenerator:
 * undefined), so there is no durable session to thread clientInfo through to a
 * later tools/call. Rather than build a fragile session map, we:
 *   - capture clientInfo on `initialize` and remember the MOST RECENT one
 *     process-wide as a soft default (helps the common single-client case), and
 *   - ALWAYS honor an explicit `variant` arg on rdc_skill_get (the must-have).
 * If no explicit variant is given and no client has initialized this process,
 * the default is `cloud`. This keeps the override correct and the auto-detect
 * best-effort, exactly as the spec permits.
 */

import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  listSkills,
  getSkill,
  getSkillBody,
  getCloudOverride,
  skillNames,
  searchSkills,
} from '../lib/catalog.mjs';
import { toCloudBody } from '../lib/cloud-rewrite.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '3110', 10);

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Commit the running process actually LOADED — resolved ONCE at startup, never
// per-request, so /health reports a PROVABLE commit. Resolution order:
//   1. git-sha.json — baked at pack/publish (scripts/stamp-git-sha.mjs). This is
//      the PRODUCTION path: the process runs from the npm install (no .git), so
//      runtime rev-parse can't work — the stamped file is the source of truth.
//   2. runtime `git rev-parse` — the DEV path (running straight from the checkout).
//   3. env override, then 'unknown'.
const GIT_SHA = (() => {
  try {
    const stamped = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'git-sha.json'), 'utf8')).sha;
    if (stamped && stamped !== 'unknown') return stamped;
  } catch { /* not stamped — fall through to runtime/dev resolution */ }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.env.RDC_SKILLS_GIT_SHA || 'unknown';
  }
})();

// Soft process-wide default variant, updated whenever a client initializes.
let lastDetectedVariant = 'cloud';

/** Map a clientInfo.name → variant. */
function variantForClient(clientName) {
  const n = String(clientName || '').toLowerCase();
  if (n.includes('claude-code') || n.includes('codex')) return 'cli';
  return 'cloud'; // claude.ai web client and anything unknown
}

/**
 * Render a skill body for the resolved variant.
 *   - cli   → SKILL.md body unchanged.
 *   - cloud → SKILL.cloud.md verbatim if present, else toCloudBody(SKILL.md).
 * Returns { header, body } or null if the skill has no body on disk.
 */
function renderSkill(name, variant) {
  const body = getSkillBody(name);
  if (body == null) return null;
  if (variant === 'cli') {
    return { header: `<!-- rdc-skills: '${name}' served as CLI variant -->`, body };
  }
  const override = getCloudOverride(name);
  if (override != null) {
    return {
      header: `<!-- rdc-skills: '${name}' served as CLOUD variant (hand-tuned SKILL.cloud.md) -->`,
      body: override,
    };
  }
  return {
    header: `<!-- rdc-skills: '${name}' served as CLOUD variant (auto-rewritten from SKILL.md) -->`,
    body: toCloudBody(body),
  };
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function buildMcpServer() {
  const srv = new McpServer({ name: 'rdc-skills', version: pkgVersion() });

  // Capture clientInfo on initialize to refine the soft default variant.
  // The SDK exposes the underlying low-level server; oninitialized fires after
  // the client's initialize params are recorded.
  try {
    srv.server.oninitialized = () => {
      const info = srv.server.getClientVersion?.();
      if (info?.name) lastDetectedVariant = variantForClient(info.name);
    };
  } catch {
    /* non-fatal: detection stays at the cloud default */
  }

  // ── rdc_skill_list ─────────────────────────────────────────────────────────
  srv.registerTool(
    'rdc_skill_list',
    {
      description:
        'List the rdc-skills catalog: every skill with its slash form, category, summary, when-to-use triggers, usage, args, and required capabilities. No input required.',
      inputSchema: {},
    },
    async () => {
      const catalog = listSkills();
      return textResult(JSON.stringify({ count: catalog.length, skills: catalog }, null, 2));
    },
  );

  // ── rdc_skill_get ──────────────────────────────────────────────────────────
  srv.registerTool(
    'rdc_skill_get',
    {
      description:
        "Get a skill's SKILL.md body rendered for the caller. variant 'cli' returns the body unchanged; 'cloud' rewrites local-shell/clauth-daemon steps for the claude.ai web client. Omit variant to use auto-detection (defaults to cloud).",
      inputSchema: {
        name: z.string().describe('Skill name (e.g. "deploy", "build"). See rdc_skill_list.'),
        variant: z.enum(['cli', 'cloud']).optional().describe('Force the rendered variant; overrides caller detection.'),
      },
    },
    async ({ name, variant }) => {
      const valid = skillNames();
      if (!valid.includes(name)) {
        return textResult(
          `Unknown skill '${name}'. Valid skills (${valid.length}): ${valid.join(', ')}`,
        );
      }
      const resolved = variant || lastDetectedVariant || 'cloud';
      const rendered = renderSkill(name, resolved);
      if (!rendered) {
        return textResult(`Skill '${name}' exists in the catalog but has no SKILL.md body on disk.`);
      }
      return textResult(`${rendered.header}\n\n${rendered.body}`);
    },
  );

  // ── rdc_skill_search ───────────────────────────────────────────────────────
  srv.registerTool(
    'rdc_skill_search',
    {
      description:
        'Fuzzy/substring search the rdc-skills catalog over name, slash, summary, and trigger phrases. Returns ranked matches.',
      inputSchema: {
        query: z.string().describe('Search terms, e.g. "deploy coolify" or "work items".'),
      },
    },
    async ({ query }) => {
      const results = searchSkills(query);
      return textResult(JSON.stringify({ query, count: results.length, results }, null, 2));
    },
  );

  return srv;
}

function startHttp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // /health — open, cheap, reports live skill count.
  app.get('/health', (_req, res) => {
    let skills = 0;
    try {
      skills = listSkills().length;
    } catch {
      skills = 0;
    }
    res.json({ status: 'ok', service: 'rdc-skills-mcp', version: pkgVersion(), git_sha: GIT_SHA, skills });
  });

  // Block OAuth discovery so connectors skip OAuth and connect direct — /mcp is open.
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.status(404).end());
  app.get('/.well-known/openid-configuration', (_req, res) => res.status(404).end());
  app.get('/authorize', (_req, res) => res.status(404).end());
  app.post('/token', (_req, res) => res.status(404).end());

  // POST /mcp — stateless StreamableHTTP transport, no Authorization required.
  app.post('/mcp', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const srv = buildMcpServer();
      await srv.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', async () => {
        await transport.close().catch(() => {});
        await srv.close().catch(() => {});
      });
    } catch (err) {
      console.error('[rdc-skills-mcp] MCP error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err?.message || 'internal error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Use POST for MCP requests' },
      id: null,
    });
  });

  app.listen(PORT, () => {
    console.log(`[rdc-skills-mcp] ready on port ${PORT}`);
    console.log(`  MCP:    POST http://localhost:${PORT}/mcp`);
    console.log(`  Health: GET  http://localhost:${PORT}/health`);
  });
}

startHttp();
