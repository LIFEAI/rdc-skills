# Tier 2 Test Manifests

Each rdc:* skill has a colocated test manifest at `skills/tests/rdc-<name>.test.json`.
These drive the Tier 2 behavioral runner (`scripts/self-test.mjs --tier2`).

## Schema

See `../../scripts/lib/manifest-schema.mjs` — the `validateManifest` function
is the source of truth. Top-level fields:

- `manifest_version` (int) — currently 1
- `skill` (string) — `rdc:<name>`
- `description` (string) — what this test verifies
- `fixture` (object) — prompt, precondition files, env vars
- `assertions` (object) — what to check after the skill runs
- `teardown` (object) — cleanup policy

## Authoring a manifest

1. Start from an existing manifest in this dir
2. Set `fixture.env.RDC_TEST = "1"` (required — sandbox contract)
3. Write assertions tight enough to catch real regressions but not flaky
4. Run `node scripts/self-test.mjs --tier2 --skill rdc:<name>` to smoke-test
5. Commit manifest + any skill changes together

## Adding a new skill

New skills MUST ship with a manifest. Tier 2 CI will block tag push if a
new skill lands without one.
