---
name: rdc:fs-mcp
description: "Usage `rdc:fs-mcp <task>` — Use the File System MCP bridge for live repo reads, safe writes, cloud-to-local ingest, and GitHub-branch imports into a dirty local monorepo. Use when Claude.ai, Cowork, or CLI agents need fs_read/fs_write/fs_import_git_files guidance."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.


# rdc:fs-mcp — File System MCP Bridge

## When to Use
- Claude.ai, Cowork, or another remote surface needs live access to `C:/Dev/regen-root` through the File System MCP.
- You need to read, search, or list current local repo files without relying on GitHub freshness.
- You need to write a small/scratch file through FS MCP.
- You need to move a larger cloud file into the local repo.
- Claude.ai created a durable new docs/corpus file on a GitHub branch and local dev needs to import it into a dirty monorepo.

## Arguments
- `rdc:fs-mcp read` — choose the right read/search/list tool.
- `rdc:fs-mcp write` — choose direct write, chunked write, append, or URL ingest.
- `rdc:fs-mcp import-git` — import named files from a GitHub branch/commit into local dev.
- `rdc:fs-mcp status` — inspect mounts and repo state before deciding.

## Procedure

### 1. Identify the file intent

Classify the file before writing:

| Intent | Default path | Default action |
|---|---|---|
| Live repo read | Existing repo path | `fs_read`, `fs_grep`, `fs_glob`, `fs_list` |
| Small scratch or relay file | `.rdc/relay/`, `.codex/tmp/`, agreed temp path | `fs_write` |
| Large text file from the current chat | Target path | `fs_write_chunk` |
| Cloud-hosted file | Target path | `fs_ingest_url` |
| Durable new docs/corpus file from Claude.ai | Actual target path in `docs/**`, `.rdc/plans/**`, `.claude/context/**` | GitHub branch commit, then `fs_import_git_files` |
| Existing file update | Existing repo path | Prefer patch/review workflow; do not overwrite unless explicitly requested |

### 2. Read/search from live local FS

Use FS MCP first for local state:

```text
fs_read CLAUDE.md
fs_glob docs/**/*.md
fs_grep "bridge mode" docs/
fs_list .rdc/relay/from-claude-code/
```

Use GitHub for remote branch/file history, PRs, and durable publication. Use FS for the current local worktree.

### 3. Choose the safest write surface

Use direct FS writes only when the payload is small and the destination is clear:

```text
fs_write path=".rdc/relay/from-claude-ai/<timestamp>-topic.md"
```

Use chunked writes for larger text:

```text
fs_write_chunk upload_id="<stable-id>" path="docs/plans/foo.md" chunk_index=0 total_chunks=3 content="..."
fs_write_chunk upload_id="<stable-id>" path="docs/plans/foo.md" chunk_index=1 total_chunks=3 content="..."
fs_write_chunk upload_id="<stable-id>" path="docs/plans/foo.md" chunk_index=2 total_chunks=3 content="..."
```

Use URL ingest when the file already exists in cloud storage:

```text
fs_ingest_url url="https://..." path="docs/source/file.md" expected_sha256="<optional>"
```

Use guarded append when appending to a known file:

```text
fs_stat path="docs/plans/foo.md"
fs_append path="docs/plans/foo.md" content="\n..." expected_sha256="<hash from fs_stat>"
```

### 4. Import durable new files from GitHub instead of large FS writes

When Claude.ai creates a durable new docs/corpus file, publish it to a GitHub branch first, then ask FS MCP to import the exact file path.

Required Claude.ai handoff shape:

```json
{
  "repo": "LIFEAI/regen-root",
  "remote": "origin",
  "ref": "claude-ai/docs-upload-123",
  "paths": ["docs/plans/foo.md"],
  "mode": "new_only",
  "commit": true,
  "message": "docs(plans): add foo"
}
```

Then call:

```text
fs_import_git_files remote="origin" ref="claude-ai/docs-upload-123" paths=["docs/plans/foo.md"] mode="new_only" commit=true message="docs(plans): add foo"
```

This tool must fetch only, restore only named paths, optionally commit only those paths, and never push.

### 5. Safety rules

- Never run or request `git pull` for the dirty monorepo.
- Never checkout a whole branch into the local worktree.
- For durable docs/corpus, save to the actual target path, not an upload folder, when the target is known.
- Use upload/incoming folders only when the final destination is unknown.
- Default to `new_only` for Git imports.
- Refuse overwrites unless the user explicitly asks for overwrite/update behavior.
- Stage only imported paths when committing.
- Never push from FS import unless the user explicitly asks for a push-capable workflow.

### 6. Completion report

Report:

```text
FS MCP: <read/write/import> complete
Paths: <paths>
Source ref/commit: <if Git import>
Local commit: <if committed>
Verification: <fs_stat/hash or import result>
Blocked/conflicts: <none or list>
```
