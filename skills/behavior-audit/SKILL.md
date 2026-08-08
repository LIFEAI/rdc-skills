---
name: rdc:behavior-audit
description: "Usage `rdc:behavior-audit <report-dir> [--since-days N] [--latest N] [--reprocess]` — produces a bounded, redacted Claude/Codex transcript evidence bundle, incrementally skips completed transcript hashes, and aligns candidate behavior problems to shared truth-governance rules."
---

> **OUTPUT CONTRACT:** Begin and end with the same checklist. Do not call an audit clean, complete, or compliant without the evidence-bundle manifest and an independent validator decision.

# rdc:behavior-audit — Cross-Engine Truth and Behavior Audit

## When to Use

- Audit transcript calls, truth-gate behavior, premature closure, evidence provenance, or cross-engine enforcement drift.
- Create a bounded redacted evidence bundle for a behavior-governance work item.
- Do not use this skill to alter source transcripts, deploy services, or self-certify a behavioral conclusion.

## Required Inputs

- `<report-dir>`: a bounded output directory, for example `reports/behavior-audit/2026-08-08`.
- Optional `--since-days N`, `--latest N`, or `--reprocess` scope controls.
- The current repository must contain `scripts/transcript_call_matrix.py`; block if it is absent rather than inventing a collector.

## Procedure

1. Create or claim a work item before collection. Its checklist must cover scope, provenance, redaction, rule alignment, independent review, and validator closure.
2. Resolve the repository root with `git rev-parse --show-toplevel`, then run CodeFlow context before reading project sources.
3. Run the collector from the repository root: `python -B scripts/transcript_call_matrix.py --since-days 7 --format none --report-dir <report-dir> --processing-ledger .rdc/state/transcript-call-processing.json`.
4. Require `manifest.json`, `tool-call-matrix.html`, `tool-call-totals.csv`, `locators.jsonl`, and `problems.jsonl` in `<report-dir>`.
5. Confirm every locator's transcript SHA matches its processed session and that secret-shaped material is absent from problem excerpts.
6. Classify each finding as an observation, causal hypothesis, intervention, or validator decision; do not elevate an observation into a diagnosis.
7. Align findings to `mission-contract-non-bypassable`, `independent-validator`, `mandatory-independent-review`, `evidence-provenance`, `no-premature-completion`, and `cross-engine-parity`.
8. Dispatch independent review and a separate validator for collector or skill changes. The collecting executor cannot close the work item.

## Decision Rules

- An empty evidence set is a validator decision (`not_applicable`), not executor proof of compliance.
- A failed collector or incomplete report leaves transcript hashes unmarked; repair and rerun.
- A changed transcript hash is new evidence even if the filename and session ID are unchanged.
- Report structural facts until a verifier attests broader behavior claims.
- Never deploy, promote, alter enforcement hooks, or rewrite transcripts as part of this audit unless a linked work item explicitly authorizes it.
