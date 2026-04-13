# CS 2.0 Agent Guide
> Role-based context for Computer Science 2.0 subsystem agents.
> This is LIFEAI-specific architecture. All CS 2.0 work happens in the LIFEAI ecosystem.

---

## The Paradigm

**Before writing ANY code, ask: "Is this building a new computational primitive, or is it wiring a UI to a database?"**

If the latter -- STOP. You are falling into CS 1.0 thinking.

CS 2.0 is a new computational paradigm. The work is to build:

1. **Languages** — Meta-compilers and AI-evolved DSLs, not traditional code
2. **Data primitives** — Time-native, certainty-propagating, cross-product-aware
3. **Memory systems** — Associative retrieval, not databases
4. **Cognitive runtimes** — Virtue-governed execution, not simple executors
5. **Governance** — Virtue weights are signed and versioned, not embedded in code

The web apps (portals, dashboards, UIs) are the **surface layer**. They display CS 2.0 systems at work. They are not the work itself.

---

## What CS 2.0 is NOT

- Wiring React components to database queries
- Building CRUD dashboards
- Adding features to Next.js apps
- Traditional API + database + frontend development

Those are CS 1.0 patterns. CS 2.0 is the substrate they run on.

---

## Seven Subsystems

### 1. HAIL (`@regen/hail`)

Meta-compiler that GENERATES domain-specific languages. Each domain (ecology, capital, governance, health, law) gets its own DSL. AI evolves these grammars. HAIL does not execute programs — it writes them.

### 2. Quad Pixel Q(M,V,A,C) (`@regen/quad-pixel`)

Language-level data primitive. Every data point carries Magnitude, Velocity, Acceleration, Certainty. Time is native, not metadata. Cross-products are built-in. Certainty propagates automatically.

### 3. AEMG (`@regen/aemg`)

Associative Episodic Memory Graph. NOT a database. Memory is retrieved through associative traversal, not lookup. Images anchor time. Virtue anchors meaning. Relevance governs forgetting. Dual-truth preservation (who you were + who you are).

### 4. Being State Processor (`@regen/being-state-processor`)

The cognitive runtime. Orchestrates lower functions under virtue governance. Lower functions execute but NEVER reason about virtue. Virtue is supplied from above, not embedded in the executor. (Like muscles don't know if they're writing a poem or committing a crime.)

### 5. Virtue Engine (`@regen/virtue-engine`)

REPLACES the reward function. Not a scoring widget. The architectural conscience invoked by all subsystems BEFORE consequential action. Virtue weights are governed, versioned, signed — never self-modified by executing layers.

### 6. Gene Expression Model

Interactions suppress or activate functions for their duration. Learned through observation over time (Quad Pixel cross-correlation), not through programming.

### 7. Domain DSLs

Each evolved by AI from HAIL grammars. One source of truth emits: Python microservices, DMN tables, BPMN flows, DTDL twins, LaTeX proofs. Five forms. All synchronized.

---

## Supporting Packages

| Package | Purpose |
|---------|---------|
| `@regen/cs2` | Core primitives and shared types |
| `@regen/cs2-integration` | Pipeline utilities, type bridges (depends on 9 packages) |
| `@regen/pal` | Personal AI Liaison -- 90s Moment Window, Graph Memory |
| `@regen/sdl` | Semantic Design Language for civic design |
| `@regen/planetary-ontology` | Earth Digital Twin -- Neo4j graph layer |
| `@regen/genetic-sandbox` | Genetic algorithm sandbox for HAIL grammar evolution |
| `@regen/reinforcement-renderer` | Reinforcement learning renderer for visual output |
| `@regen/visual-model` | Visual modelling primitives |

---

## Package Dependency Graph

```
Layer 0 (roots -- no @regen/ deps):
  cs2  quad-pixel  virtue-engine  genetic-sandbox

Layer 1 (single root dep):
  sdl (quad-pixel)
  planetary-ontology (quad-pixel)

Layer 2 (2-3 root deps):
  pal (quad-pixel, virtue-engine)
  hail (genetic-sandbox, quad-pixel, virtue-engine)
  reinforcement-renderer (genetic-sandbox, quad-pixel, sdl, virtue-engine)

Layer 3 (composite):
  aemg (pal, quad-pixel, virtue-engine)
  visual-model (quad-pixel, reinforcement-renderer)

Layer 4 (deep composite):
  being-state-processor (aemg, pal, quad-pixel, virtue-engine)

Layer 5 (integration hub):
  cs2-integration (9 deps -- aggregates all CS 2.0 packages)
```

---

## SOLID Mapping

| Principle | CS 2.0 Application |
|-----------|---------------------|
| **S** Single Responsibility | BSP executes. Virtue governs. Structurally distinct. |
| **O** Open/Closed | HAIL grammars extended via DSL patches under governance, not code mods. |
| **L** Liskov | Lower Functions are interchangeable end-effectors under governance. |
| **I** Interface Segregation | PAL, Virtue Engine, RCCS, HAIL are independent services. |
| **D** Dependency Inversion | Executing layers depend on virtue abstractions, not concrete impls. Apps depend on `@regen/` packages, never on each other. |

---

## When Building Portal-Layer Apps

Even portal/UI work must reflect CS 2.0 architecture:

- **Data display** -- show through Quad Pixel awareness (velocity, not just magnitude)
- **Consequential actions** -- consult Virtue Engine before executing
- **UX rhythm** -- PAL's 90-second Moment Window
- **Memory/history** -- use AEMG (associative traversal, not chronological lists)
- **Governance/rules UI** -- reference HAIL grammar constructs

---

## Architecture Direction (Apr 8, 2026)

### HAIL = AI Skill

HAIL is not a traditional compiler. It is an AI skill — Claude reads the grammar definition and generates code in the target format. The grammar evolves through genetic algorithms in the sandbox.

### Ontology = Prebuilt Earth Shadow Tree

The planetary ontology is 85% pre-built from existing Earth system data (climate zones, watersheds, ecosystems, soil types). Not built from scratch — populated from authoritative datasets then extended per-project.

### RCCS = 8-Layer Pipeline

The RCCS credit system has 8 processing layers:
1. Instrumentation (sensors/data collection)
2. Ingestion (normalize + validate)
3. HAIL grammar application
4. CalcProof (immutable delta-I computation)
5. Verification (third-party audit)
6. CUT Registry (credit issuance)
7. NAV integration
8. BPMN governance flows

Immutable delta-I is the core — every credit traces back to a verified change from baseline.

### Contracts for Unnatural Systems

Systems operating outside natural boundaries (mining, heavy industry) get contracts that define remediation obligations, not credits.

### Governance-Gated Expansion

New domains (health, education, urban) are added only through governance votes, not ad-hoc code additions. HAIL grammar proposals go through the virtue engine before activation.

---

## Reference Documents

| Document | Location |
|----------|----------|
| Complete Architecture v3 | `docs/source/LifeAI_CS20_Complete_Architecture_v3.docx` |
| Zoen Covenant | `docs/source/Zoen_Covenant_Complete_Draft.docx` |
| Master Spec | `docs/systems/cs2/cs2-master-spec.md` |
| Architecture | `docs/systems/cs2/ARCHITECTURE.md` |
| Package Map | `docs/systems/cs2/package-map.md` |
| Architecture Research | `docs/systems/cs2/architecture-research-apr8.md` |

---

## Specialist Context — Read These for Domain-Specific Tasks

| If your task involves... | Read this file first |
|--------------------------|----------------------|
| HAIL grammar compiler internals, DSL target formats | `packages/hail/CLAUDE.md` |
| PAL session lifecycle, MomentWindow, GraphMemory | `packages/pal/CLAUDE.md` |
| Virtue engine weights, coherence scoring, certification | `packages/virtue-engine/CLAUDE.md` |
| Quad Pixel primitive design, velocity/acceleration/certainty | `packages/quad-pixel/CLAUDE.md` |
| Full package dependency graph, integration layer | `docs/systems/cs2/ARCHITECTURE.md` |
