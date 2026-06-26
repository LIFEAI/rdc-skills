# Tier 2 Test Manifests

Each RDC skill directory has a colocated test manifest at `skills/tests/rdc-<name>.test.json`.
There are currently 29 manifests for 29 skill directories. These drive the Tier 2
behavioral runner and the build acceptance harness for both Claude and Codex.

See `MATRIX.md` for the current skill-by-skill coverage table.

## Schema

See `../../scripts/lib/manifest-schema.mjs` — the `validateManifest` function
is the source of truth. Top-level fields:

- `manifest_version` (int) — currently 1
- `skill` (string) — `rdc:<name>`
- `description` (string) — what this test verifies
- `fixture` (object) — prompt, precondition files, env vars
- `assertions` (object) — what to check after the skill runs
- `acceptance` (object, optional) — assistant output and recorded tool-call assertions
- `teardown` (object) — cleanup policy

`acceptance` supports:

- `output_contains` — strings that must appear in the rendered assistant output
- `output_not_contains` — strings that must not appear in the rendered assistant output
- `tool_calls_include_any` — at least one recorded tool call with a listed name
- `tool_calls_include_all` — all listed tool-call names must be recorded
- `tool_calls_argument_matches` — tool-call argument regex matchers for source/corpus/tool routing checks

## Authoring a manifest

1. Start from an existing manifest in this dir
2. Set `fixture.env.RDC_TEST = "1"` (required — sandbox contract)
3. Write assertions tight enough to catch real regressions but not flaky
4. Run `node scripts/acceptance.mjs --skill rdc:<name>` to capture the Claude transcript, tool calls, and lessons learned
5. When Codex behavior matters, also run `node scripts/acceptance.mjs --engine codex --skill rdc:<name>` against the same manifest
6. Commit manifest + any skill changes together

For content-producing skills, include both positive and negative output checks.
Use `stdout_contains` for expected channel-native structure and source facts;
use `stdout_not_contains` for source-fidelity violations or explicitly forbidden
claims.

## Adding a new skill

New skills MUST ship with a manifest. Tier 2 CI will block tag push if a
new skill lands without one.
