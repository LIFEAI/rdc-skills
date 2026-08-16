---
name: rdc:behavior-audit
description: "Usage `rdc:behavior-audit <report-dir> [--since-days N] [--latest N] [--reprocess]` — produces a bounded, redacted Claude/Codex transcript evidence bundle, incrementally skips completed transcript hashes, and aligns candidate behavior problems to the shared truth-governance rules. Use for gate avoidance, premature closure, evidence, review, or cross-engine behavior audits."
---

> **OUTPUT CONTRACT:** Begin and end with the same checklist. Do not call an audit clean, complete, or compliant without the evidence-bundle manifest and an independent validator decision.

# rdc:behavior-audit — Cross-Engine Truth and Behavior Audit

## Purpose

Use this skill to audit observed behavior of Codex and Claude against one engine-neutral governance contract. It is a socio-technical audit, not a clinical diagnosis. The output separates **observation**, **causal hypothesis**, **intervention**, and **validator decision**.

The audit is incremental. It never edits a source transcript. A transcript is considered processed only after the collector successfully writes its bundle and records the transcript's SHA-256 in a persistent ledger. The same bytes are skipped on later runs; a changed hash is automatically re-opened. `--reprocess` is the explicit override.

## Required Inputs

- `<report-dir>`: a new or existing bounded output directory, e.g. `reports/behavior-audit/2026-07-30`.
- Optional `--since-days N` or `--latest N` scope controls.
- Optional transcript roots; defaults are the current user's Codex and Claude transcript homes.

Never place a credential, raw secret, or full transcript copy in the report directory.

## Procedure

1. Create or claim a work item before collection. Its checklist must include collection scope, provenance, redaction, rule alignment, independent review, and validator closure.
2. Resolve the repository root with `git rev-parse --show-toplevel`; run CodeFlow context before reading or writing project sources.
3. Run the collector from the repository root:

   ```text
   python -B scripts/transcript_call_matrix.py `
     --since-days 7 `
     --format none `
     --report-dir <report-dir> `
     --processing-ledger .rdc/state/transcript-call-processing.json
   ```

   Add `--reprocess` only when an auditor intentionally needs to re-read completed hashes. Do not delete the ledger to force a rerun.
4. Require these artifacts in `<report-dir>`:

   - `manifest.json` — collector hash, processed/skipped transcript hashes, runtime provenance, redaction policy, and counts.
   - `tool-call-matrix.html` and `tool-call-totals.csv` — human-readable aggregate output.
   - `locators.jsonl` — immutable file hash plus line, byte offset, turn, and excerpt hash.
   - `problems.jsonl` — redacted candidate findings linked to locators and rule IDs.
5. Check `manifest.json` before making any behavioral claim:

   - Record engine, model/provider/version where present; missing provenance is reported as missing, never inferred.
   - Confirm every locator's transcript SHA matches the corresponding processed session.
   - Confirm secret-shaped material is absent from problem excerpts.
   - Treat a candidate finding as an observation requiring validator assessment, not as a diagnosis or proof of intent.
6. Align findings to the shared rules below. One engine's pass cannot establish cross-engine compliance.

   | Rule ID | Contract |
   |---|---|
   | `mission-contract-non-bypassable` | Accuracy amendments preserve lineage and authority; no bypass, substitution, or silent narrowing. |
   | `independent-validator` | Executor submits evidence; a separate validator decides applicability and closure. |
   | `mandatory-independent-review` | Required code review must have a durable receipt; executor prose is not a receipt. |
   | `evidence-provenance` | Claims bind to hash, locator, command, runtime provenance, and scope. |
   | `no-premature-completion` | A narrower completed item cannot stand in for an incomplete parent contract. |
   | `cross-engine-parity` | Claude and Codex enforcement is verified from live wiring, not policy text alone. |
7. For each validated case, create a historical Psychiatrist Bench entry in the Behavioral Governance ledger with:

   - observed behavior and locator hashes;
   - causal hypotheses clearly labeled as hypotheses;
   - intervention and measured outcome;
   - Systems Tetrad: enhance, obsolesce, retrieve, reverse;
   - affected engine/model/runtime/ruleset version; and
   - linked work item and independent validator decision.

   CodeFlow stores the behavioral evidence graph and inquiry links. Supabase work items remain the authority for executable tasks and closure.
8. Dispatch the mandatory independent code review for collector/skill changes, then a separate validator. Do not close the work item from the collecting executor context.

## Decision Rules

- **No data to validate** is a validator decision. Record `not_applicable` with the evidence scope; do not let an executor assert it.
- A failed collector or incomplete report directory leaves transcript hashes unmarked. Repair and rerun.
- A transcript hash that changes is new evidence, even if the filename and session ID are unchanged.
- Report only structural facts until a verifier attests the broader behavior claim.
- Do not deploy, promote, alter enforcement hooks, or rewrite source transcripts as part of an audit unless a linked work item explicitly authorizes that action.
