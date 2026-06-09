---
name: rdc-brochurify
version: 0.1.0
description: |
  Orchestrate a Brochurify job from source ingest through delivered PDF, using six parallel-dispatched typed sub-agents and the convergence loop. Use this skill EVERY TIME the user invokes Brochurify directly via "brochurify this", "make a brochure from", "convert this to a brochure PDF", or "rdc:brochurify". Also runs automatically when a job arrives from the broker via monkey_dispatch. The skill enforces D-001 through D-016 from the brochurify DECISIONS-LOG.
triggers:
  - "rdc:brochurify"
  - "brochurify this"
  - "make a brochure from"
  - "convert to brochure PDF"
  - "generate brochure from"
  - monkey_dispatch payload with skill="brochurify"
---

# rdc:brochurify Orchestrator

The orchestrator dispatches six waves of typed sub-agents in sequence. Each wave has a clear input contract, an output contract, and a parallelism profile.

## Inputs

The orchestrator accepts a job payload:

```json
{
  "job_id": "uuid",
  "source": {
    "kind": "url" | "html" | "docx" | "md" | "jsx" | "corpus",
    "ref": "https://..." | "file:///path/..." | "<html>..." | { corpus_query }
  },
  "mode": "read-only" | "cosmetic" | "editorial" | "creative",
  "theme": "prt" | "place-fund" | "zoen" | "evergreen" | "editorial-neutral",
  "page_size": "letter" | "a4" | "legal" | "digest" | "tabloid",
  "brief": "optional natural-language brief for editorial/creative modes",
  "org_id": "uuid",
  "user_id": "uuid"
}
```

## Outputs

- A PDF in R2 (`brochurify-output` bucket) with a signed URL
- A completion record in Supabase `brochure_jobs` with:
  - `pdf_r2_key`, `pdf_url`
  - `final_grade`, `page_scores` (jsonb array)
  - `iter` (iteration count reached)
  - `trace` (jsonb log of all 6 waves × iterations)

## The Six Waves

### Wave 1 — Ingest

**Goal:** Normalize any source into kit-compliant JSX.

**Sub-agent:** `ingest-author` (typed agent with the `lifeai-brochure-author` skill loaded)

**Inputs:** raw source from job payload
**Outputs:** `working/draft.jsx` (kit-compliant JSX) + `working/assets/` (extracted images)

**Per-source handling:**
- `url` — fetch via Playwright (whitelist) or structural-summary mode (open web)
- `html` — direct ingest, strip scripts/iframes/ads
- `docx` — pandoc to HTML, then ingest
- `md` — render to HTML, then ingest
- `jsx` — pre-built input; skip to validate
- `corpus` — Creative mode only; corpus reader + Author-Mode-* sub-agent

**Failure mode:** if ingest cannot map content to kit primitives, raise a structured error with the unmappable content range and ask the user to clarify.

### Wave 2 — Validate

**Goal:** Confirm the JSX passes static and structural validation before render.

**Sub-agent:** none — runs `pnpm bk-lint working/draft.jsx` directly

**Behavior:**
- If pass → Wave 3
- If fail → return errors to Wave 1 agent, retry once
- If fail twice → escalate to orchestrator: try a different ingest strategy, page-size change, or surface to user

**Every failure here writes to `enhancement-log.jsonl`** with:
- `src: "ingest-author"`
- `fail_layer: "static"` or `fail_layer: "structural"`
- The specific rule violated

### Wave 3 — Render

**Goal:** Produce a first-iteration PDF and per-page screenshots.

**Sub-agent:** none — runs Paged.js via Playwright headless

**Process:**
1. Build the kit + theme bundle into `working/bundle.html`
2. Open with Paged.js polyfill
3. Wait for `pagedjs:rendered` event
4. Snapshot DOM after pagination → `working/paged.html`
5. Per-page screenshot at 150 DPI → `working/pages/page-{N}.png`
6. Render to PDF → `working/iter-{i}.pdf`

**Failure mode:** if Paged.js fails to converge (rare; usually a kit bug), fall back to print-to-PDF without paged-media polyfill, flag as low-quality iteration, continue.

### Wave 4 — Grade (Vision, Parallel)

**Goal:** Score each page against the 7-dimension rubric.

**Sub-agent:** `vision-grader` — dispatched **once per page in parallel**.

**Per-page inputs:**
- The page screenshot
- The source JSX for that page (extracted by walking the paginated DOM)
- The rubric (R1-R7 with weights and target ranges)

**Per-page outputs (structured):**
```json
{
  "page": 3,
  "grade": 82,
  "dimensions": {
    "R1_margin_integrity": 95,
    "R2_bottom_slack": 70,
    "R3_heading_breathing": 85,
    "R4_widows_orphans": 100,
    "R5_image_placement": 80,
    "R6_table_integrity": 100,
    "R7_text_density": 75
  },
  "issues": [
    {"dim": "R2", "desc": "tail gap 1.1in below last paragraph", "fix_hint": "compress paragraph or push next-page content"}
  ]
}
```

**Document grade:** `min(page_grades)` per D-013.

**Convergence:**
- Grade ≥ 75 → Wave 6 (Deliver)
- Grade < 75 AND iter < 10 → Wave 5 (Patch)
- iter = 10 → Wave 6 with `partial=true` flag

### Wave 5 — Patch (Parallel)

**Goal:** Produce a corrected JSX that addresses the issues from Wave 4.

**Sub-agent:** `patch-author` — dispatched **once per low-graded page in parallel**.

**Mode restrictions:**
- `read-only` — only break, sizing, spacing patches allowed
- `cosmetic` — read-only patches + image resize, caption compression, paragraph splits at sentence boundaries
- `editorial` — cosmetic + paragraph rewrites within 15% character or 25% word reduction
- `creative` — editorial + free composition (the authoring sub-agent fully active)

**Patch types:**
- `force-break-before` — insert page break before an element
- `adjust-spacing` — change Stack/Cluster gap variant
- `resize-figure` — change Figure width/height variant
- `compress-paragraph` — drop or merge a sentence (cosmetic+ only)
- `rewrite-paragraph` — full rewrite (editorial+ only)
- `rebalance-cluster` — split a Cluster onto two pages
- `change-affinity` — adjust an affinity prop

Each patch is applied to `working/draft.jsx`, the validator re-runs, then Wave 3 renders again.

**Edit tracking (editorial mode):** every paragraph rewrite is logged with before/after to `working/edits.jsonl`. The completion record includes this log.

### Wave 6 — Deliver

**Goal:** Final PDF, signed URL, completion record.

**Process:**
1. Upload final PDF to R2 with key `brochurify-output/{org_id}/{job_id}.pdf`
2. Generate 7-day signed URL
3. Update `brochure_jobs` row:
   ```sql
   UPDATE brochure_jobs SET
     status = 'completed',
     iter = $iter,
     current_grade = $grade,
     page_scores = $pageScoresJson,
     pdf_r2_key = $r2Key,
     pdf_url = $signedUrl,
     completed_at = now()
   WHERE id = $jobId;
   ```
4. Send SSE event `{type:"complete", url, grade, iter}` to broker
5. Append enhancement log entries from this run to `enhancement-log.jsonl`

## Trace Logging

Every wave appends to `working/trace.jsonl`:

```jsonl
{"ts":"...","wave":1,"agent":"ingest-author","iter":1,"status":"start"}
{"ts":"...","wave":1,"agent":"ingest-author","iter":1,"status":"complete","blocks":127}
{"ts":"...","wave":2,"iter":1,"status":"complete","errors":0}
{"ts":"...","wave":3,"iter":1,"status":"complete","pages":8,"render_ms":2340}
{"ts":"...","wave":4,"iter":1,"page":1,"grade":85,"status":"complete"}
{"ts":"...","wave":4,"iter":1,"page":2,"grade":68,"status":"complete","issues":2}
...
```

This trace is stored in `brochure_jobs.payload.trace` for forensic review.

## Cost Profile

- **Wave 1:** 1 sub-agent call (one model invocation)
- **Wave 2:** 0 model calls (deterministic validator)
- **Wave 3:** 0 model calls (deterministic render)
- **Wave 4:** N parallel model calls (N = page count)
- **Wave 5:** M parallel model calls (M = pages needing patch; usually 0-3)
- **Wave 6:** 0 model calls

Typical 8-page brochure, 2 iterations: ~1 + 16 + 4 = ~21 model calls total. All on Max plan. Zero per-job API cost.

## Hard Caps

- **Max iterations:** 10 (per D-006)
- **Max wall-clock:** 15 minutes per job
- **Max page count:** 50 (anything larger is split into multiple jobs)
- **Max source size:** 5MB raw HTML, 25MB docx, 50MB total assets

Exceeding any cap → job fails with structured error; no partial billing.

## Failure Recovery

| Failure | Recovery |
|---|---|
| Validator fails repeatedly | Try page-size change (Letter → Legal → Digest) before failing job |
| Vision agent disagrees with itself | Lock grade after 3 iterations of same page; mark "best-effort" |
| Convergence not reached at iter=10 | Ship best version, flag low-graded pages, log to enhancement |
| Paged.js render fails | Fall back to direct PDF; flag low-quality iteration |
| R2 upload fails | Retry 3x then fall back to Supabase storage URL |

## When to invoke

Direct user invocation: `rdc:brochurify <source-url-or-path> [--mode] [--theme] [--page-size]`

Programmatic invocation: a `monkey_dispatch` job arriving with `skill="brochurify"` and the job payload as `args`.

Either path executes the same 6-wave loop. Direct user invocation also returns the trace and the PDF URL to the calling session.
