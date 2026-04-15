---
name: rdc:viz
description: >-
  Dispatch a viz agent for custom visualization components — charts, diagrams,
  SVG visualizations, and data displays. Use when work involves complex interactive
  diagrams, financial flow visualizations, or data-driven displays.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:viz — Visualization Agent

## Mandatory First Steps

Read BOTH guides before ANY code:
```
{PROJECT_ROOT}/.rdc/guides/frontend.md (fallback: {PROJECT_ROOT}/.rdc/guides/frontend.md)
{PROJECT_ROOT}/.rdc/guides/design.md (fallback: {PROJECT_ROOT}/.rdc/guides/design.md)
```

## Before Writing Any Code

1. **Check for existing prototypes:**
   ```sql
   SELECT name, component, source_path, status, notes
   FROM prototype_registry
   WHERE status IN ('prototype', 'converting')
   ORDER BY created_at DESC;
   ```
   Source path is usually `docs/source/`. **Read it first.**

2. **Check design decisions:**
   ```sql
   SELECT topic, summary FROM design_context
   WHERE topic ILIKE '%<viz-name>%';
   ```

## SVG Layout Patterns

When building new SVG-based viz:
- Define all layout constants at top (`W`, `H`, column x-centers, box dimensions)
- Build path builders as pure functions
- Separate data from rendering
- Use `viewBox` for responsive scaling
- Animate with appropriate motion libraries

```tsx
const W = 980, H = 570;
const COL_A = 80, COL_B = 240, COL_C = 435;

function pathTo(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}
```

## Viz Component Contract

```tsx
"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

// CVA variants required on every new viz component
const myVizVariants = cva("relative w-full", {
  variants: {
    layout: { single: "", double: "flex flex-col", grid: "" },
    density: { compact: "", comfortable: "", spacious: "" },
  },
  defaultVariants: { layout: "single", density: "comfortable" },
});

interface MyVizProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof myVizVariants> {}

const MyViz = React.forwardRef<HTMLDivElement, MyVizProps>(
  ({ className, layout, density, ...props }, ref) => (
    <div ref={ref} className={cn(myVizVariants({ layout, density }), className)} {...props} />
  )
);
MyViz.displayName = "MyViz";
export { MyViz, myVizVariants };
```

Export from package's index after building.

## Registering New Viz Components

After completing:
```sql
INSERT INTO prototype_registry (name, component, source_path, notes, created_by)
VALUES (
  'MyViz v1.0',
  'MyViz',
  'packages/ui/src/components/my-viz.tsx',
  'Production component. Props: <list key props>',
  'agent'
);
```

## Safety Rules

- Branch: development branch — auto-commit
- NEVER run `pnpm build`
- Reduce motion: always wrap animations with appropriate hooks
- NEVER overlap with other agents on the same component file
- Write tests FIRST — red → implement → green
