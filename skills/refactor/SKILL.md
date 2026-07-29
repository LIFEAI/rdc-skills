---
name: rdc:refactor
description: "Usage `rdc:refactor <epic-id|topic> --takeover <reason>` — Governed consolidation and implementation of a cross-cutting refactor. Authorizes an explicit takeover, preserves evidence, re-parents relevant work through the consolidation RPC, isolates every writer, and uses the same review, validator, landing, and delivery gates as rdc:build."
---

> **OUTPUT CONTRACT:** `guides/output-contract.md`

# rdc:refactor

Use this when an existing implementation must be reorganized across files,
apps, packages, or repositories and Dave has explicitly authorized takeover.

## Arguments

- `rdc:refactor <epic-id|topic> --takeover <reason>`
- `--takeover` is required when any relevant item is actively owned by another
  session. Record the prior owner, prior session, actor, timestamp, and reason.

## Contract

1. Load CodeFlow and the current `rdc:build` procedure.
2. Inventory relevant work items. Keep unrelated product, deployment, CodeFlow,
   and fleet-product work in their existing epics.
3. Use `consolidate_work_items_into_epic` for takeover/re-parenting. Never raw
   update or delete work items.
4. Preserve every evidence-bearing item. Archive only a proven duplicate whose
   acceptance scope and evidence are fully represented by the surviving item.
5. Create a collaboration manifest for the refactor containing:
   `manifest_id`, `work_item_id`, `topic_id`, `thread_id`, `reply_to`,
   participant `handle`, execution `role`, repository, lane, branch, declared
   path scope, commit references, test/evidence references, and takeover record.
6. Branch by governed issue/outcome, not by app. One monorepo branch may touch
   multiple apps with explicit path attribution. A cross-repository outcome uses
   one linked feature branch per repository.
7. Every dispatched writer uses a unique leased worktree. Non-isolated agents
   are read-only. Collaboration shares commits, manifests, and evidence—never a
   working directory.
8. Converge through serialized landing: lock, fetch the current integration
   branch, rebase, auto-resolve only mechanical conflicts, rerun verification,
   and land. Preserve both branches and ask an LLM advisor to reconcile any
   unresolved semantic conflict first. Escalate to HITL only when advice cannot
   resolve it, the choice is destructive, or it bifurcates a CS 2.0 pattern.
9. Run the same post-wave tests, `rdc:review`, independent validator, delivery,
   publish/install, and live-runtime gates as `rdc:build`.
10. Close the corrective epic only after merged-source and installed-runtime
    evidence satisfy every required checklist row.

## Output

Return the build-style checklist plus takeover provenance, repository/branch
map, review verdict, validator verdict, delivered SHAs/versions, and live probes.
