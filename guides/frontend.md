# Frontend Agent Guide — Base
> Role-based context for frontend/UI agents. Generic patterns across projects.

---

## Core Import Rule

**ALWAYS import from the project's component library.** NEVER import directly from headless UI libraries, animation libs, or icon libraries.

```ts
// Correct (project import)
import { Button, DataTable, Card } from "@project/ui";

// Wrong - never do this
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
```

The project overlay will specify the exact import path.

---

## Component Tier Architecture

Most projects organize components into tiers. Check the project overlay for:
- **Tier 1** — Headless/primitive components (forms, layout, data)
- **Tier 2** — Domain-specific components (app-specific business logic UI)
- **Tier 3** — Animated effects (hero sections, public pages)
- **Tier 4** — Brand/personality components (marketing, accent effects)

Use the right tier for the context:
- CRUD/admin UI → Tiers 1-2
- Public/marketing pages → Tiers 3-4

---

## Component Creation Contract

All new components must follow the standard contract:

```tsx
"use client"; // only if uses hooks/browser APIs
import * as React from "react";
import { cn } from "../lib/utils";  // from project's UI lib

interface MyComponentProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "outline";
}

const MyComponent = React.forwardRef<HTMLDivElement, MyComponentProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div ref={ref} className={cn("base-classes", className)} {...props} />
  )
);
MyComponent.displayName = "MyComponent";
export { MyComponent };
```

Then re-export from the project's index. Placement:
- Generic UI: `packages/ui/src/components/`
- Animated effects: `packages/ui/src/components/effects/` or similar subdirectory
- Brand accents: `packages/ui/src/components/brand/` or similar

---

## Variant Axes — Every Component

Every component must support variant axes. Use CVA (class-variance-authority) or equivalent.

| Axis | Examples | When it matters |
|------|----------|----------------|
| Brand | app-specific brands | Every component |
| Visual style | default / heritage / minimal / quiet | Different expression per context |
| Size | xs / sm / md / lg / xl / 2xl | Hero ≠ sidebar |
| Shape | sharp / soft / pill / circle | Cards, buttons, badges |
| Density | compact / comfortable / spacious | Data-heavy vs editorial |
| State | default / hover / active / disabled / loading | Interactive components |

Every custom component ships with its variant matrix on day one.

---

## Styling Rules

- **Tailwind utility classes only** — never inline styles
- **Never hardcode colors** — always use CSS variables from the project
- **Class merging** via `cn()` from project's UI library
- **No Tailwind conflicts** — use design tokens for everything

---

## Typography

Never hardcode `font-family` — use CSS variables or Tailwind classes.

The project overlay specifies:
- Primary UI font
- Display/heading font
- Mono font for code
- Type scale (text-xs through text-4xl)

---

## Tailwind Rules

- **Content paths** -- every `tailwind.config.ts` must include the project's UI package
- **Class merging** -- always use `cn()` from project's UI library
- **Colors** -- CSS variables only, never hardcode hex
- **Spacing** -- 4px scale (or project-specific)
- **Border radius** -- use project's radius token

---

## Asset Handling

The project specifies folder structure, naming convention, and usage patterns.

General pattern:
- Store in `apps/[app]/public/images/[category]/`
- Naming: `[type]-[name]-[variant].[ext]` (lowercase kebab-case)
- Always use framework Image component with `width`, `height`, `alt`

---

## Next.js / React-Specific Patterns

Check project overlay for:
- Framework version (Next.js 13/14, React 18/19, etc.)
- App Router vs Pages Router
- Dynamic import patterns for browser-only libs
- transpilePackages config for monorepo
- Middleware patterns

---

## Dependencies Managed by Project UI Library

Most dependencies (Radix, TanStack, recharts, framer-motion, CodeMirror, etc.) are managed by the project's UI package. Apps don't install them separately.

---

## Specialist Context — Read Project Overlay

Your task may require reading additional project-specific rule files.

The project overlay will indicate what specialized guides are needed for:
- Brand system work
- Design token inheritance
- Specific app pages or routes
- Image/asset handling
- OG image generation
