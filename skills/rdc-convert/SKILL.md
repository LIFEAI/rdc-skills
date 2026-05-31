---
name: rdc-convert
version: 0.1.0
description: |
  Convert Office documents to/from Markdown with the build-corpus CLI: .docx/.pptx/.ppt → Markdown (Word OMML equations become KaTeX-readable TeX; tables, images, headings preserved), and Markdown → Word (.docx) where inline $...$ and display $$...$$ LaTeX become NATIVE Office Math (OMML) that Word renders as real equations. Use this skill whenever the user asks to convert a Word/PowerPoint document to Markdown, build a Markdown corpus from Office files, turn Markdown into a .docx (optionally with a .dotx template), or "open the report" to edit. Install build-corpus straight from GitHub and run it in the session.
triggers:
  - "convert this docx to markdown"
  - "convert to word"
  - "docx to markdown"
  - "pptx to markdown"
  - "markdown to docx"
  - "build a markdown corpus"
  - "render the equations to word"
  - "build-corpus"
---

# rdc-convert — Office ↔ Markdown conversion (build-corpus)

`build-corpus` is a Python CLI that converts between Office documents and Markdown.
This is a self-contained skill: install the tool from GitHub into the current
session and run `build-corpus`. No local checkout or other rdc skill is required.

## When to Use
- `.docx` / `.pptx` / `.ppt` → Markdown — preserves Word OMML equations (as
  KaTeX-readable TeX), tables, images, headings, and lists.
- Markdown → Word (`.docx`) — inline `$...$` and display `$$...$$` LaTeX are
  converted to **native OMML** Word renders as real equations; optional `.dotx`
  template via `--word-template`.
- Build a Markdown corpus from a folder of Office files (recursive, one pass).
- Inline a Markdown file's images as data URIs, or rehost them to R2/S3.

## When NOT to Use
- Rendering a folder/HTML/zip into a print-ready **PDF** brochure (that is a
  separate brochure pipeline).
- Rasterizing HTML/JSX/SVG to images — build-corpus is a format converter, not a
  render engine; it flags those and a separate render step handles them.

## Install & Run (install from GitHub — it is the source of truth)

The published PyPI/npm packages lag GitHub. Install from the repository to get the
current behavior (native LaTeX→OMML, the fidelity report, the escaped-currency fix):

```bash
pip install "git+https://github.com/LIFEAI/build-corpus.git@feat/dual-package-ubuntu"
# once merged to main, drop the @branch:
#   pip install "git+https://github.com/LIFEAI/build-corpus.git"
build-corpus --help
```

This installs the `build-corpus` command and its dependencies (latex2mathml,
mathml2omml, python-docx, Pillow, omml2latex). Notes:
- Debian/Ubuntu externally-managed Python (PEP 668): add `--break-system-packages`,
  use a venv, or `pipx install "git+https://github.com/LIFEAI/build-corpus.git@feat/dual-package-ubuntu"`.
- S3/R2 image upload: append `[s3]` to the package spec.
- Legacy `.ppt` input also needs LibreOffice (`soffice`) on PATH (`apt install libreoffice`).
  `.docx`/`.pptx` need nothing extra.

## Command Reference

```
build-corpus <input> [input ...] [options]
```

`<input>` — one or more `.md`, `.docx`, `.pptx`, or `.ppt` files or directories.

| Flag | Values / default | Effect |
|------|------------------|--------|
| `--out <dir>` | path | Output directory for the converted tree. |
| `--out-same-dir` | — | Write `.md`, `.assets`, and reports beside each source file. |
| `--to` | `auto` \| `markdown` \| `word` (default `auto`) | Output target. `auto` infers from a single-file input. |
| `--images` | `assets` \| `base64` \| `s3` (default `assets`) | Image handling. |
| `--equations` | `tex` \| `image` (default `tex`) | docx→md: OMML → KaTeX TeX, or rendered images (debug). |
| `--inline-images` | — | Emit `<name>.inline.md` with images embedded as data URIs. |
| `--word-template <file>` | `.docx`/`.dotx` | Template for Markdown → Word exports. |
| `--move-sources` | — | After a successful convert, move sources into a `sources/` folder. |
| `--config <file>` | JSON | Conversion/output/S3 defaults (CLI flags override). |

S3/R2 (only with `--images s3`): `--s3-bucket`, `--s3-public-base-url`,
`--s3-prefix`, `--s3-endpoint-url` (required for R2), `--s3-region` (`auto` for R2),
`--s3-access-key-id`, `--s3-secret-access-key`, `--s3-cache-control`, `--s3-acl`.

## Equations (real in both directions)
- **docx → markdown** (`--equations`): `tex` converts Word OMML equations to
  KaTeX-readable TeX (default); `image` renders them as images (debug only).
- **markdown → word** (`--to word`): inline `$...$` and display `$$...$$` LaTeX are
  converted to **native OMML** (`\sum`, `\int`, `\frac`, `\Delta`, `\rightarrow`,
  `\leq`, …). Escaped currency like `\$252.3B` is kept as literal text, never mistaken
  for math. Unparseable fragments fall back to Cambria-Math text and are flagged in the
  report. Fence display math with `$$` on their own lines, no blank lines inside.

## Fidelity report (md → word)
Each md→word export writes `export-report.json` (and a batch report) so you can
confirm nothing was silently dropped or changed:
- **`fidelity_ok`** — top-level ship gate (`true` only when every row matches and no
  equation fell back).
- **`reconciliation`** — input vs output per type (`tables`, `equations`
  {in/out_omml/fell_back}, `images` {in/out/failed}, `code_blocks`, `headings`, `links`).
- **`issues`** — `{ type, line, source|target, reason }` per problem.
- **`text_fixups`** — markdown escapes the engine resolved (e.g. `currency_unescaped`).
- A one-line **stdout digest** for a quick glance.

Image-failure `reason` values: `missing-file`, `unsupported-on-platform` (EMF/WMF —
install LibreOffice), `unsupported-format` (.html/.jsx — route to a render pipeline),
`svg-needs-rasterization` / `mislabeled-svg` (rasterize the SVG to PNG and repoint),
`skipped-remote`.

## Examples

```bash
build-corpus input.docx --out out                              # docx → markdown
build-corpus deck.pptx --out out                               # pptx → markdown
build-corpus ./word-files --out ./markdown                     # whole folder, recursive
build-corpus ./word-files --out-same-dir                       # write beside each source
build-corpus input.md --to word --out out                      # markdown → Word (LaTeX → OMML)
build-corpus input.md --to word --word-template custom.dotx --out out
build-corpus report.md --inline-images                         # → report.inline.md
build-corpus input.docx --images s3 --config build-corpus.config.json
```

## Boundaries
- Does not commit, deploy, or upload outputs (except images when `--images s3`).
- Does not modify source documents unless `--move-sources` is passed.
- Does not rasterize HTML/JSX/SVG — flags them for an external render step.

## Reference
- Source (install from here): `github.com/LIFEAI/build-corpus`
- Packages (currently lag GitHub): PyPI `build-corpus`, npm `regen-mde`.
