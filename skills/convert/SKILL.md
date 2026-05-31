---
name: rdc:convert
description: "Usage `rdc:convert <input> [--out <dir>] [--to markdown|word] [--images assets|base64|s3]` — Convert .docx/.pptx/.ppt → Markdown (Word OMML equations as KaTeX TeX, tables, images) or Markdown → Word via the build-corpus CLI (PyPI `build-corpus`, npm `regen-mde`). Portable: runs in any session that can reach npm or PyPI — Claude Code CLI and claude.ai both fetch + run it. Use whenever the user asks to convert an Office document, build a Markdown corpus from .docx/.pptx, turn Markdown into a .docx, or 'open the report' in the regen-mde editor (Windows)."
---

# rdc:convert — Office ↔ Markdown conversion (build-corpus) + regen-mde editor

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

`build-corpus` is the conversion CLI; `regen-mde` is the Windows GUI editor. Same
package, two surfaces. This skill is a **when-to-use + full call/switch reference** —
it does NOT require a local checkout. Any runtime that can reach npm or PyPI can
fetch and run the tool in its own session (this is how claude.ai uses it).

## When to Use
- Convert `.docx`, `.pptx`, or `.ppt` → Markdown, preserving Word OMML equations
  (as KaTeX-readable TeX), tables, images, headings, and lists.
- Convert Markdown → Word (`.docx`), optionally with a `.dotx` template.
- Build a Markdown corpus from a folder of Office files (one pass, recursive).
- Inline a Markdown file's images as data URIs, or rehost them to R2/S3.
- "Open the report / open this doc to edit" → `regen-mde <file>` (Windows GUI only).

## When NOT to Use
- Rendering a folder/HTML/zip into a print-ready **PDF** brochure → use `rdc:brochure`.
- Authoring brochure JSX for the Brochurify pipeline → use `lifeai-brochure-author`.

## Obtain & Run (portable — pick whatever the current runtime supports)

The command is always `build-corpus <input> [flags]`. Resolve the binary like this:

1. **Already on PATH?** Use it directly: `build-corpus --help`.
2. **Install straight from GitHub — REQUIRED for current behavior** (native LaTeX→OMML
   equations, the fidelity report, and the escaped-currency fix; the PyPI/npm packages
   below currently LAG GitHub):
   ```bash
   pip install "git+https://github.com/LIFEAI/build-corpus.git@feat/dual-package-ubuntu"
   # once merged to main, drop the @branch:
   #   pip install "git+https://github.com/LIFEAI/build-corpus.git"
   ```
   This installs the `build-corpus` CLI and its deps (latex2mathml, mathml2omml,
   python-docx, Pillow, omml2latex). On Debian/Ubuntu externally-managed Python, add
   `--break-system-packages`, use a venv, or `pipx install "git+https://github.com/LIFEAI/build-corpus.git@feat/dual-package-ubuntu"`.
3. **PyPI / npm (only if you do NOT need the latest fixes — these lag GitHub):**
   `pipx install build-corpus` · `npx -y -p regen-mde build-corpus <input> [flags]`
4. **Legacy `.ppt` input** additionally needs LibreOffice (`soffice`) on PATH
   (`sudo apt install libreoffice`). `.docx`/`.pptx` need nothing extra.
5. **S3/R2 image upload** needs the extra: append `[s3]` to the package spec.

claude.ai note: install from GitHub (step 2) into the analysis/session sandbox and run
`build-corpus` there. GitHub is the source of truth until PyPI/npm are republished.

## Command Reference

```
build-corpus <input> [input ...] [options]
```

`<input>` — one or more `.md`, `.docx`, `.pptx`, or `.ppt` files or directories.

| Flag | Values / default | Effect |
|------|------------------|--------|
| `--out <dir>` | path | Output directory for the converted tree. |
| `--out-same-dir` | — | Write `.md`, `.assets`, and reports **beside** each source file. |
| `--to` | `auto` \| `markdown` \| `word` (default `auto`) | Output target. `auto` infers from a single-file input. |
| `--images` | `assets` \| `base64` \| `s3` (default `assets`) | Image handling (see below). |
| `--equations` | `tex` \| `image` (default `tex`) | OMML equations → KaTeX TeX, or rendered images (debug only). |
| `--inline-images` | — | Emit `<name>.inline.md` with local/HTTP images embedded as data URIs. |
| `--word-template <file>` | `.docx`/`.dotx` | Template for Markdown → Word exports. |
| `--move-sources` | — | After a successful convert, move sources into a `sources/` folder. |
| `--config <file>` | JSON | Conversion/output/S3 defaults (CLI flags override). |

S3/R2 (only with `--images s3`): `--s3-bucket`, `--s3-public-base-url`,
`--s3-prefix`, `--s3-endpoint-url` (required for R2), `--s3-region` (`auto` for R2),
`--s3-access-key-id`, `--s3-secret-access-key`, `--s3-cache-control`, `--s3-acl`.
Prefer keeping S3 secrets in `--config`, not on the command line.

### Image modes (`--images`)
- `assets` — copy images into an `.assets` folder and reference them (default).
- `base64` — embed images directly as Markdown data URIs.
- `s3` — upload to S3-compatible storage (Cloudflare R2 / AWS S3); needs the S3 flags or `--config`.

### Equations (both directions are real)
- **docx → markdown** (`--equations`): `tex` converts Word OMML equations to
  KaTeX-readable TeX (default); `image` renders them as images (debug only).
- **markdown → word** (`--to word`): inline `$...$` and display `$$...$$` LaTeX
  are converted to **native Office Math (OMML)** that Word renders as real
  equations (`\sum`, `\int`, `\frac`, `\Delta`, `\rightarrow`, `\leq`, …) — not
  raw text in a math font. Unparseable fragments fall back to Cambria Math text
  and are flagged in the export report. Requires build-corpus ≥ 0.4.0. Fence
  display math with `$$` on their own lines, no blank lines inside the fence.

## Editor — `regen-mde` (Windows only)

```
regen-mde <document.md|document.docx> [options]
```
Aliases: `mdeditor`, `regen-mdeditor`, `build-corpus-editor`.

| Flag | Effect |
|------|--------|
| `--foreground`, `--visible` | Show the editor as an attached foreground process. |
| `--background` | Launch hidden/offscreen (smoke checks). |
| `--self-test` | Verify the editor bridge can open the document. |
| `--document-self-test` | Open, edit, save Markdown, export Word, reconvert. |
| `--out <dir>` | Output directory for the document self-test. |

The GUI is a .NET 8 + WebView2 app and is **Windows-only by design**. On Linux/macOS
use the `build-corpus` CLI; there is no Linux editor build.

## Examples

```bash
build-corpus input.docx --out out                              # docx → markdown
build-corpus deck.pptx --out out                               # pptx → markdown
build-corpus ./word-files --out ./markdown                     # whole folder, recursive
build-corpus ./word-files --out-same-dir                       # write beside each source
build-corpus input.docx --images base64                        # embed images inline
build-corpus input.md --to word --out out                      # markdown → Word
build-corpus input.md --to word --word-template custom.dotx --out out
build-corpus report.md --inline-images                         # → report.inline.md
build-corpus input.docx --images s3 --config build-corpus.config.json

# portable one-offs when build-corpus is not yet installed:
pipx run build-corpus input.docx --out out
npx -y -p regen-mde build-corpus input.docx --out out
```

## Boundaries
- Does not commit, deploy, or upload outputs (except images when `--images s3` is set).
- Does not modify source documents unless `--move-sources` is passed.
- Does not install global dependencies implicitly — fetch via `pipx`/`npx` as shown.
- The `regen-mde` GUI is Windows-only; do not attempt to launch it on Linux/macOS.

## Reference
- Package: PyPI `build-corpus`, npm `regen-mde` (version-locked, dual-channel).
- Source: `github.com/LIFEAI/build-corpus` (`C:/Dev/build-corpus` locally).
