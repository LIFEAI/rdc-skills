---
name: rdc:regen-media
description: "Usage `rdc:regen-media <generate|edit|upscale|upload> <brief-or-path>` - Primary image-generation and Regen Media asset workflow. Use for image generation, image editing/upscaling, GPT Image/gpt-image-2 requests, Codex built-in image_gen, and uploading finished images to regen-media/R2. The default path is keyless local Codex gpt-image-2 via the built-in image_gen tool; server-side regen-media MCP/API generation is fallback only."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1`. Under `RDC_TEST=1`, do not call Codex image generation, OpenAI, regen-media APIs, upload endpoints, clauth credentials, or external services. Print the planned command and output paths only.

# rdc:regen-media

Primary image-generation and asset-ingest workflow for Regen Media.

## Default Decision

Use local Codex built-in `image_gen` with `gpt-image-2` first when all are true:

- The caller is local Codex with `codex` CLI available.
- `codex login status` reports ChatGPT login.
- `codex features list` includes stable `image_generation`.
- The task is generation, editing, re-rendering, or upscaling an image.

Use regen-media MCP/API generation only when the local keyless Codex path is unavailable, when running in a remote/cloud session, or when the user explicitly asks for server-side generation.

Use regen-media upload/registration after the image file exists and should become a managed media asset.

## Local Keyless gpt-image-2

Preflight:

```bash
codex login status
codex features list
```

Requirements for size to apply:

1. Use `--enable image_generation`.
2. Use `-c model=gpt-5.5`.
3. Instruct Codex: `use the built-in image_gen tool DIRECTLY; do not write API keys, scripts, or MCP`.
4. Name the target size in the instruction, such as `2048x1152`, `2048x2048`, or `3840x2160`.

Text to image:

```bash
echo "Use the built-in image_gen tool DIRECTLY at size 3840x2160 (4K). No API keys/scripts/MCP. Copy the PNG to output/imagegen/<name>.png and reply with only that path + pixel dims. Prompt: <dense art-directed prompt>." | codex exec --enable image_generation --dangerously-bypass-approvals-and-sandbox --cd "$PWD" -c model=gpt-5.5
```

Image edit, re-render, or upscale:

```bash
echo "Use the built-in image_gen tool DIRECTLY to re-render the ATTACHED image at size 3840x2160 (4K), preserving its composition, subject, palette, and lighting. No API keys/scripts/MCP. Save to output/imagegen/<name>-4k.png and reply with only the path + dims." | codex exec -i "input/source.png" --enable image_generation --dangerously-bypass-approvals-and-sandbox --cd "$PWD" -c model=gpt-5.5
```

Notes:

- The keyless path uses the local ChatGPT Pro OAuth in the Codex install, not `OPENAI_API_KEY`.
- Output may land both in the requested path and under `~/.codex/generated_images/<session-id>/ig_*.png`.
- Use a long timeout or background session; generation commonly takes 2-5 minutes.
- Valid `gpt-image-2` sizes include `1024x1024`, `1536x1024`, `1024x1536`, `2048x2048`, `2048x1152`, `3840x2160`, `2160x3840`, and `auto`, subject to model constraints.

## Upload to Regen Media

After generation, upload finished images through the project uploader when available:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "{PROJECT_ROOT}/scripts/upload-to-media.ps1" "output/imagegen/<name>.png"
```

The uploader obtains `regen-media-api` from clauth and posts to Regen Media. Never print credential values. If upload is not required, return the local artifact path and dimensions.

## Server-Side Fallback

Use the deployed regen-media MCP/API generation path only when the local Codex image tool is unavailable or inappropriate. This path is credentialed, server-side, and may require an OpenAI/API key configured for the service. Treat it as fallback for generation, not the default.

## Procedure

1. Classify the task: `generate`, `edit`, `upscale`, or `upload`.
2. If `RDC_TEST=1`, print the selected path and planned commands without executing external calls.
3. For generation/edit/upscale, attempt the local keyless Codex preflight.
4. Build the Codex `exec` command with the requested size and explicit built-in `image_gen` instruction.
5. Save to `output/imagegen/` or a caller-provided path.
6. Verify the file exists and record pixel dimensions.
7. If the artifact should be managed, upload it to Regen Media and return the media URL/slug plus local path.
8. If local Codex is unavailable, use the server-side regen-media generation fallback and clearly say that it is the fallback path.

## Boundaries

- Do not write or expose API keys.
- Do not silently downgrade from local keyless `gpt-image-2` to server-side MCP/API generation.
- Do not use prompt-only size hints; always set the Codex command and instruction shape above.
- Do not run generation or upload in test mode.
