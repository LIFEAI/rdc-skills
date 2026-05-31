---
name: rdc:brochure
description: "Usage `rdc:brochure <input> [--out <path>] [--template <name>] [--format Letter|A4]` — Turn a zip, folder, HTML file, URL, or markdown folder into a print-quality PDF brochure via Puppeteer. Auto-detects print-variant HTML, honors @page CSS, falls back to a Studio-token-aware template when no HTML exists."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> **Sandbox contract:** Honors `RDC_TEST=1`. Under the flag the skill renders to a fixture path and skips any post-deploy or upload steps.

# rdc:brochure — Zip / Folder / HTML → PDF Brochure

A focused render pipeline. Two modes:

1. **Render mode** — input already contains print-ready HTML. Skill picks the best HTML file and renders it.
2. **Compose mode** — input is a folder of assets + markdown/text with no HTML. Skill composes a Studio-token-aware brochure layout, then renders it.

## When to Use
- A client zip of deliverables that includes a print-first HTML doc (FuturVille ASP, ranch reports, project plans).
- A `places/<slug>/` or `apps/<app>/` markdown package that needs a PDF artifact.
- A single URL or HTML file you want as a clean PDF.

## When NOT to Use
- Production marketing collateral that lives in `apps/*` and ships via Coolify — that goes through `rdc:design` + `rdc:deploy`.
- Multi-document publication systems — use `rdc:plan` to scaffold first.

## Arguments
- `rdc:brochure <input>` — path to `.zip`, folder, `.html`, `.md`, or `http(s)://...` URL.
- `--out <path>` — output PDF path. Default: `<input-basename>.pdf` next to the input (or `./brochure.pdf` for URLs).
- `--template <name>` — compose-mode template. Default `studio-default`. Templates live in `scaffold/templates/brochure-*.html`. An unknown name errors out and lists the available template(s) — it does not silently fall back.
- `--format Letter|A4` — page size. Default `Letter`.
- `--margin <css>` — override margin. Default honors `@page` from source CSS, else `0.6in 0.7in`.
- `--no-print-emulate` — render with screen media instead of print.
- `--keep-workdir` — keep the staged working directory for inspection.
- `--auto-fit` — inject corrective print-fit CSS (oversized images, wide tables, long code, heading orphans, figure splits) and log overflow diagnostics. Use when source HTML overflows page boundaries.
- `--scale <n>` — PDF scale factor (e.g. `0.92` to tighten). Default `1`.

## Procedure

1. **Resolve input.**
   - Zip → extract to `tmp/rdc-brochure/<hash>/src`.
   - Folder → stage in place (read-only).
   - URL → fetch into a sandbox dir as `index.html` + linked assets via Puppeteer.
   - `.html` → stage as-is.
   - `.md` or folder-without-html → compose mode.

2. **Pick HTML in render mode.**
   - Prefer the largest standalone HTML containing `@page` or `@media print` rules.
   - Else prefer files matching `*-print.html`, `*-brochure.html`, `print.html`.
   - Else the largest HTML at root.

3. **Compose mode.**
   - Read the chosen template (`scaffold/templates/brochure-studio-default.html`).
   - Inventory the input dir: `*.md`, `*.txt`, images grouped by directory, `cover.*`, `logo.*`.
   - Render markdown to HTML, inject into template slots: cover, foreword, sections, figures, back-matter.
   - Use Studio token CSS (Source Serif 4 + Hanken Grotesk, loam/moss/ochre palette) as the default. If a sibling `tokens.css` is present, prefer that.

4. **Render with Puppeteer.**
   - `headless: 'new'`, `--font-render-hinting=none`.
   - `waitUntil: 'networkidle0'`, await `document.fonts.ready`, then 1500ms settle.
   - `emulateMediaType('print')` unless `--no-print-emulate`.
   - `printBackground: true`, `preferCSSPageSize: true`.
   - Letter @ `0.6in 0.7in` default margins.

5. **Verify.**
   - Output exists and `> 50KB`.
   - PDF metadata: page count > 0.
   - Log: input, picked HTML or template, page count, file size, output path.

## Output

```
PDF:    <absolute path>
Pages:  <n>
Size:   <human bytes>
Source: <input> → <chosen html or template>
```

## Boundaries
- Does not commit, publish, or upload the resulting PDF. The user moves it.
- Does not modify the source input.
- Does not auto-install global dependencies — uses `npx puppeteer` via the skill's own `node_modules` if present, otherwise an on-demand local install under `~/.cache/rdc-brochure/`.
- Compose-mode templates live in `scaffold/templates/brochure-*.html`. New templates need `rdc:plan` if they cross the architectural-change-approval triggers.

## Implementation
The executable is `scripts/rdc-brochure.mjs` (in the rdc-skills repo). Invoke directly:

```powershell
node {RDC_SKILLS_ROOT}/scripts/rdc-brochure.mjs <input> [--out path] [--template name] [--format Letter|A4]
```

## Examples

```powershell
# Zip of deliverables with print HTML inside
rdc:brochure "C:/Users/me/Downloads/FuturVille Deliverables.zip"

# Folder of markdown + images, compose a brochure
rdc:brochure "places/futurville-vulcan" --template studio-default --out reports/futurville.pdf

# Single HTML to PDF, A4
rdc:brochure docs/source/some-prototype.html --format A4

# URL
rdc:brochure https://example.com/spec.html --out spec.pdf
```
