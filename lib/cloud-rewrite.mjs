/**
 * lib/cloud-rewrite.mjs — transform a CLI SKILL.md body into a cloud
 * (claude.ai web) body.
 *
 * The CLI bodies assume a Claude Code session on Dave's Windows host: a local
 * clauth HTTP daemon at 127.0.0.1:52437, a local shell, PM2, git, pnpm, and
 * local node scripts. The claude.ai web client has NONE of those — it reaches
 * credentials through the clauth MCP and the filesystem through the File System
 * MCP, and it cannot run local processes at all.
 *
 * `toCloudBody(markdown)` applies rule-based rewrites:
 *   1. clauth daemon curl  → "retrieve `<svc>` via the clauth MCP"
 *   2. local shell/Bash fs ops + local `fs` → File System MCP tools
 *   3. CLI-only mechanics (PM2 reload, git push, local node scripts, daemon
 *      restart, pnpm) → annotated with a callout (NOT deleted — the cloud
 *      caller needs to know to hand that step to a Claude Code session).
 *
 * The rewriter is intentionally rule-based and conservative: it annotates rather
 * than rips out, so no information is lost. A hand-tuned `SKILL.cloud.md` (handled
 * by the caller in catalog.mjs) bypasses this entirely.
 *
 * Contract: the cloud body for `deploy` MUST NOT contain `127.0.0.1:52437`.
 */

const CLI_CALLOUT = '> ⚠ CLI-only step — hand this to a Claude Code session.';

/**
 * Rule 1 — clauth daemon credential retrieval.
 * Matches `curl ... http://127.0.0.1:52437/v/<svc>` (and /get/<svc>), with or
 * without flags, optionally wrapped in $(...). Collapses to instruction text.
 */
function rewriteClauthCurls(md) {
  let out = md;

  // `_VAR=$(curl ... 127.0.0.1:52437/v/<svc>)`  → assignment-style instruction
  out = out.replace(
    /([A-Za-z_][A-Za-z0-9_]*)=\$\(\s*curl[^\n)]*?(?:127\.0\.0\.1|localhost):52437\/(?:v|get)\/([A-Za-z0-9._-]+)[^\n)]*\)/g,
    (_m, varName, svc) => `# ${varName}: retrieve \`${svc}\` via the clauth MCP (clauth_inject / clauth_get)`,
  );

  // bare `curl ... 127.0.0.1:52437/v/<svc>` → instruction
  out = out.replace(
    /curl[^\n]*?(?:127\.0\.0\.1|localhost):52437\/(?:v|get)\/([A-Za-z0-9._-]+)[^\n]*/g,
    (_m, svc) => `retrieve \`${svc}\` via the clauth MCP (clauth_inject / clauth_get)`,
  );

  // any remaining ping/list/other daemon references → MCP instruction
  out = out.replace(
    /curl[^\n]*?(?:127\.0\.0\.1|localhost):52437\/(?:ping|list-services|status|meta)[^\n]*/g,
    'check clauth health via the clauth MCP (clauth_ping / clauth_status)',
  );

  // belt-and-suspenders: kill any stray bare daemon URL still standing
  out = out.replace(
    /https?:\/\/(?:127\.0\.0\.1|localhost):52437\/(?:v|get)\/([A-Za-z0-9._-]+)/g,
    (_m, svc) => `the clauth MCP value for \`${svc}\``,
  );
  out = out.replace(
    /https?:\/\/(?:127\.0\.0\.1|localhost):52437\S*/g,
    'the clauth MCP',
  );

  return out;
}

/**
 * Rule 2 — local shell/Bash file ops and a local `fs` → File System MCP.
 * We add a one-line note rather than rewriting every cat/ls/grep, since the
 * shapes vary wildly; the note tells the cloud caller which tools to reach for.
 */
function rewriteFsOps(md) {
  let out = md;
  // Direct references to a local `fs` module / node fs.
  out = out.replace(
    /\bnode:fs\b|\brequire\(['"]fs['"]\)\b|\bfrom ['"]fs['"]/g,
    'the File System MCP (fs_read/fs_write/fs_glob/fs_grep)',
  );
  return out;
}

/**
 * Rule 3 — flag CLI-only mechanics with a callout. We annotate fenced code
 * blocks and bullet/numbered lines that contain a CLI-only verb. The callout
 * is inserted ABOVE the offending block/line; the content is preserved.
 */
const CLI_ONLY_PATTERNS = [
  /\bpm2\s+(?:start|restart|reload|delete|stop|list|status)\b/i,
  /\bgit\s+push\b/i,
  /\bpnpm\b/i,
  /\bnpm\s+(?:install|run|publish|ci)\b/i,
  /\bnode\s+[A-Za-z0-9_./-]+\.(?:mjs|cjs|js)\b/i,
  /\brestart-clauth(?:\.bat)?\b/i,
  /\bclauth\s+(?:scrub|restart|serve|lock|unlock)\b/i,
];

function isCliOnlyLine(line) {
  return CLI_ONLY_PATTERNS.some((re) => re.test(line));
}

/**
 * Walk the markdown line by line. Inside fenced ``` blocks, if ANY line trips a
 * CLI-only pattern, emit one callout immediately before the fence. Outside code
 * blocks, annotate individual list/prose lines that trip a pattern.
 */
function annotateCliOnly(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s*)```/);
    if (fenceMatch) {
      // Collect the whole fenced block.
      const block = [line];
      let j = i + 1;
      for (; j < lines.length; j++) {
        block.push(lines[j]);
        if (/^\s*```/.test(lines[j])) {
          j++;
          break;
        }
      }
      const hasCliOnly = block.some(isCliOnlyLine);
      if (hasCliOnly) out.push(`${fenceMatch[1]}${CLI_CALLOUT}`);
      out.push(...block);
      i = j;
      continue;
    }

    // Non-fence line: annotate list/prose lines that trip a pattern, but never
    // double-annotate (skip if previous emitted line is already the callout).
    if (isCliOnlyLine(line) && out[out.length - 1] !== CLI_CALLOUT) {
      const indent = (line.match(/^(\s*)/) || ['', ''])[1];
      out.push(`${indent}${CLI_CALLOUT}`);
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

/**
 * Transform a CLI SKILL.md body into the cloud body.
 * Order matters: rewrite clauth curls FIRST (they often live in code blocks that
 * the CLI-only annotator would otherwise also flag), then fs ops, then annotate
 * remaining CLI-only mechanics.
 */
export function toCloudBody(markdown) {
  if (typeof markdown !== 'string' || !markdown) return markdown;
  let out = markdown;
  out = rewriteClauthCurls(out);
  out = rewriteFsOps(out);
  out = annotateCliOnly(out);
  return out;
}
