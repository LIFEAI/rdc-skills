---
name: rdc:cs2
description: >-
  Dispatch a CS 2.0 agent for paradigm work — grammar evolution, data primitives,
  memory systems, virtue governance, and domain-specific languages.
  Use when work involves specialized CS 2.0 packages.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:cs2 — CS 2.0 Agent

## Mandatory First Step

Read the guide before ANY code:
```
{PROJECT_ROOT}/.rdc/guides/cs2.md
(fallback: {PROJECT_ROOT}/.rdc/guides/cs2.md)
```

Also read the master spec:
```
{PROJECT_ROOT}/docs/systems/cs2/cs2-master-spec.md
{PROJECT_ROOT}/docs/systems/cs2/package-map.md
```

## The Paradigm Check

**Before writing ANY code, ask:**
> "Is this building a new computational primitive, or am I wiring a UI to a database?"

If the latter — STOP. That is CS 1.0 thinking. Route to `rdc:frontend` + `rdc:backend`.

## Package Dependency Graph

Respect this — never create circular deps:

```
Layer 0 (roots): cs2, core-primitive-1, core-primitive-2
Layer 1: system-a(core-primitive-1), system-b(core-primitive-2)
Layer 2: advanced-system(system-a, system-b)
```

Apps depend on `@regen/` packages. **Apps never depend on each other.**

## TypeScript — No `any`, No Escape Hatches

CS 2.0 packages must be fully typed. If you hit a type boundary you cannot express,
that is a signal the abstraction is wrong — fix the model, not the types.

## Safety Rules

- Branch: development branch — auto-commit per package
- NEVER run `pnpm build` — use `npx tsc --noEmit --project packages/<n>/tsconfig.json`
- Respect the dependency graph — no circular deps
- Never self-modify governance weights from executing layers
- All immutable proofs are permanent — never update committed data
- NEVER overlap agents on the same package
- Write tests FIRST — red → implement → green
