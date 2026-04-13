---
name: rdc:frontend
description: >-
  Dispatch a frontend agent to build React components, pages, and UI.
  Use when the project lead says "build a component", "add a page", "make the UI for",
  or any work involving TSX files, styling, Next.js pages, or animation.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:frontend — Frontend Agent

## Mandatory First Step

Read the guide before ANY code:
```
{PROJECT_ROOT}/.rdc/guides/frontend.md
(fallback: {PROJECT_ROOT}/.rdc/guides/frontend.md)
```

## Before Writing Any Code

1. **Check for existing prototypes:**
   ```sql
   SELECT name, component, source_path, status, notes
   FROM prototype_registry
   WHERE status IN ('prototype', 'converting')
   ORDER BY created_at DESC;
   ```
   If a prototype exists: **ADAPT IT. Do not build from scratch.**

2. **Check design decisions:**
   ```sql
   SELECT topic, summary FROM design_context
   WHERE topic ILIKE '%<task-topic>%'
   ORDER BY created_at DESC;
   ```

3. **Read the app CLAUDE.md** for the target app.

## New Component Contract

All new components follow the standard pattern:

```tsx
"use client"; // only if uses hooks/browser APIs
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const myComponentVariants = cva("base-classes", {
  variants: {
    variant: { default: "", outline: "" },
    size: { sm: "", md: "", lg: "" },
  },
  defaultVariants: { variant: "default", size: "md" },
});

interface MyComponentProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof myComponentVariants> {}

const MyComponent = React.forwardRef<HTMLDivElement, MyComponentProps>(
  ({ className, variant, size, ...props }, ref) => (
    <div ref={ref} className={cn(myComponentVariants({ variant, size }), className)} {...props} />
  )
);
MyComponent.displayName = "MyComponent";
export { MyComponent, myComponentVariants };
```

Then re-export from the package's index.

## Next.js Patterns

- App Router (modern) — use `src/app/`
- Dynamic imports for browser-only libs
- `transpilePackages` in next.config must list all monorepo packages used
- Auth: use the auth helpers for protected apps; pass-through for public

## Colors — CSS Variables ONLY

Never hardcode hex values in components. Always use CSS variables from the app's globals.css.

## Safety Rules

- Branch: development branch — auto-commit after logical blocks
- NEVER run `pnpm build` — crashes the system; code only
- NEVER overlap with other agents on the same files
- NEVER modify files outside your assigned scope
- After completing: commit with descriptive message, push
- Update work item to `done` via `update_work_item_status()`
- Write tests FIRST — red → implement → green
