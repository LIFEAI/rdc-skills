# Orchestration Epic Guide

An orchestration epic governs a repeatable build, test, or delivery workflow
rather than one feature. It must define:

1. Exact trigger surfaces and deterministic scope classification.
2. The isolated environment model and live-system boundaries.
3. Happy, repair, rollback, and block paths.
4. A suite matrix with machine-checkable evidence.
5. Bounded repair attempts and semantic escalation.
6. Definition-of-Done, exit gates, and a durable receipt schema.
7. The hook, skill, validator, commit gate, or deployment gate that prevents bypass.
8. How RDC planning, build, refactor, review, and validators discover it.

At minimum, prove trigger clarity, worker isolation, subsystem coverage,
bounded repair, evidence-preserving block behavior, durable receipts, active
enforcement, and closure with no pending required work.
