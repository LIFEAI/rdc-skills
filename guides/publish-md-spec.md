---
type: spec
role: publish-md
systems: [deploy, release, plan]
schema_version: "1.0"
tags: [publish-md, spec, rdc-skills]
---
# PUBLISH.md — Authoritative Specification
> Version: 1.0 | Effective: 2026-05-22
> Architectural approval: 2026-05-22 interview (Option A — Full Rollout)

Every deployable target in the RDC ecosystem MAY carry a `PUBLISH.md` file
in its root directory. Skills that deploy, release, and plan read this file
to derive watch paths, surface metadata, and promotion gates.

---

## Schema

A `PUBLISH.md` file consists of two parts:

1. **YAML frontmatter** — app-level metadata, bounded by `---` delimiters.
2. **One or more surface sections** — per-surface metadata, bounded by
   HTML comment markers (`<!-- SURFACE:<name> -->` … `<!-- /SURFACE:<name> -->`).

Frontmatter is authoritative. Surface sections are the publish manifest.

---

## Frontmatter Fields

All fields are required unless marked optional.

```yaml
---
schema_version: "1.0"          # (required) always "1.0" for this revision
entity_slug: <slug>            # (required) matches app_deployments.app_slug
artifact_type: <type>          # (required) one of: website | api | package | worker | mcp-server
environments: [dev]            # (required) array; subset of: dev, prod
status: active                 # (required) one of: active | draft | deprecated
notes: ""                      # (optional) free-text, ignored by validator
---
```

### Field Reference

| Field | Type | Required | Allowed Values |
|-------|------|----------|---------------|
| `schema_version` | string | yes | `"1.0"` |
| `entity_slug` | string | yes | must match `app_deployments.app_slug` |
| `artifact_type` | string | yes | `website` · `api` · `package` · `worker` · `mcp-server` |
| `environments` | string[] | yes | subset of `[dev, prod]`; at least one required |
| `status` | string | yes | `active` · `draft` · `deprecated` |
| `notes` | string | no | free-text annotation |

#### `environments` semantics

- `[dev]` — surface is only available on the PM2 dev server
- `[prod]` — surface is only available on the Coolify production instance
- `[dev, prod]` — surface exists in both tiers

The validator enforces: each value in `environments` must match an
`app_deployments.environment` row for the same `entity_slug`.

#### `status` semantics

- `active` — `rdc:release` promotion is allowed
- `draft` — `rdc:release` will block and print a warning; dev deploy is allowed
- `deprecated` — `rdc:release` will block; validator flags as warn

---

## Surface Sections

Each deployable surface gets one managed section inside the PUBLISH.md body.
Sections are bounded by HTML comment markers so skills can read and rewrite
them without clobbering hand-authored prose.

```
<!-- SURFACE:<name> -->
path: /
source_dir: apps/baru-website
build_type: nextjs
visibility: public
cache: no-store
watch_paths:
  - apps/baru-website/**
  - packages/ui/**
  - packages/supabase/**
<!-- /SURFACE:<name> -->
```

### Surface Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | URL path prefix served by this surface (e.g. `/`, `/api`) |
| `source_dir` | string | yes | Monorepo-relative path to the source directory |
| `build_type` | string | yes | `nextjs` · `static` · `docker` · `node` · `edge` |
| `visibility` | string | yes | `public` · `private` · `internal` |
| `cache` | string | yes | HTTP cache directive: `no-store` · `immutable` · `stale-while-revalidate` · `max-age=N` |
| `watch_paths` | string[] | yes | gitignore-style globs; at least one required. These are unioned to derive Coolify `watch_paths`. |
| `artifact_id` | string | no | Stable ID for `artifact_registry` upserts; defaults to `<entity_slug>/<name>` |

### `<name>` convention

The surface name appears in the comment markers and must be a short,
lowercase, hyphen-separated identifier that describes the surface:

- `website` — primary web UI
- `api` — REST/GraphQL API
- `mcp` — Model Context Protocol server endpoint
- `worker` — background worker or cron
- `static` — purely static asset serving

Multiple surfaces are allowed per file (e.g. a Next.js app that also exposes
an API surface under `/api`).

---

## Environments Array

The top-level `environments` field declares which deployment tiers host this app.
Each surface inherits the app-level `environments` unless overridden at the
surface level (not supported in schema v1.0 — planned for v1.1).

Validator enforcement:
1. At least one environment must be declared.
2. Each declared environment must be one of `dev` or `prod`.
3. Each declared environment must have a corresponding `app_deployments` row for the `entity_slug`.

`rdc:deploy` uses `environments` to determine whether a dev or prod deploy is
appropriate for the given target. `rdc:release` requires `prod` to be present
before promoting.

---

## Opt-out (File Absence)

**PUBLISH.md absence = opt-out.** There is no sentinel field, no `publish: false`.

A deployable target without a `PUBLISH.md`:
- Is skipped by `rdc:deploy`'s watch-paths derivation step.
- Is NOT inserted into `artifact_registry` on deploy.
- Is flagged as a **warn** (not fail) by the validator during the Option A rollout period.
- Will become a **fail** once the rollout is complete (controlled by the `--strict` flag on the validator).

Packages and libraries that are not independently deployed (e.g. `@regen/ui`)
do not require a `PUBLISH.md`. Only targets with a row in `app_deployments` are in scope.

---

## Validator Contract

The validator (`scripts/validate-publish-manifests.js`) operates in two modes:

### Warn mode (default, during rollout)

In warn mode the validator:
- Queries `app_deployments` for all `status = 'active'` rows.
- For each row, checks whether a `PUBLISH.md` exists at the expected path.
- For rows without `PUBLISH.md`: emits a `WARN` line and continues.
- For rows WITH `PUBLISH.md`: parses YAML frontmatter and validates all required fields.
- If frontmatter is invalid (missing required field, bad enum value): emits a `FAIL` line.
- Exits 0 if there are no `FAIL` lines (warns are non-fatal in this mode).

### Strict mode (`--strict`)

In strict mode:
- Missing `PUBLISH.md` is treated as `FAIL`, not `WARN`.
- Exits non-zero if any registered active app is missing a manifest.
- Used in CI after Option A rollout is complete.

### Field validation rules

| Check | Fail condition |
|-------|---------------|
| `schema_version` present | missing or not `"1.0"` |
| `entity_slug` present | missing or empty string |
| `artifact_type` present | missing or not in allowed set |
| `environments` present | missing, empty array, or contains unknown value |
| `status` present | missing or not in allowed set |
| At least one surface section | no `<!-- SURFACE: -->` markers found |
| `watch_paths` non-empty | surface section has no `watch_paths` entries |

---

## Consumer Skills

### `rdc:deploy`

Reads PUBLISH.md during the deploy pre-flight step:

1. Locates `PUBLISH.md` in the app's `source_dir`.
2. Parses YAML frontmatter — fails deploy if invalid.
3. Unions all `watch_paths` across surface sections.
4. Updates `app_deployments.watch_paths` with the union.
5. After a successful deploy, calls `storeArtifact` (INSERT into `artifact_registry`) for each surface section.

If `PUBLISH.md` is absent, `rdc:deploy` skips steps 2–5 and proceeds with the deploy without watch-path derivation.

### `rdc:release`

Reads PUBLISH.md during the promotion pre-flight gate:

1. Locates `PUBLISH.md` in the app's `source_dir`.
2. Checks `status` field — blocks promotion if `status != "active"`.
3. Checks `environments` array — blocks promotion if `prod` is not declared.
4. If checks pass, proceeds with Coolify promotion.

### `rdc:plan`

When scaffolding a new app, reads the `PUBLISH.md.template` from
`scaffold/templates/` and hydrates it with the app's metadata to produce
a starter `PUBLISH.md` in the new app directory.

---

## Example PUBLISH.md — baru-website

```markdown
---
schema_version: "1.0"
entity_slug: baru-website
artifact_type: website
environments: [dev]
status: active
notes: "Baru.dev — reference implementation for PUBLISH.md convention"
---

# baru-website

<!-- SURFACE:website -->
path: /
source_dir: apps/baru-website
build_type: nextjs
visibility: public
cache: no-store
watch_paths:
  - apps/baru-website/**
  - packages/ui/**
  - packages/supabase/**
<!-- /SURFACE:website -->
```

---

## Example PUBLISH.md — regen-media MCP server

```markdown
---
schema_version: "1.0"
entity_slug: regen-media
artifact_type: mcp-server
environments: [dev, prod]
status: active
notes: "Regen Media MCP — R2 image library, Flux/MJ generation, embeddings"
---

# regen-media

<!-- SURFACE:mcp -->
path: /mcp
source_dir: mcp-servers/regen-media
build_type: docker
visibility: internal
cache: no-store
watch_paths:
  - mcp-servers/regen-media/**
<!-- /SURFACE:mcp -->

<!-- SURFACE:api -->
path: /api
source_dir: mcp-servers/regen-media
build_type: docker
visibility: private
cache: no-store
watch_paths:
  - mcp-servers/regen-media/**
<!-- /SURFACE:api -->
```

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-05-22 | Initial spec — OQ-1/OQ-2/OQ-3 resolved; Option A Full Rollout approved |
