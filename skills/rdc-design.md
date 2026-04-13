---
name: rdc:design
description: >-
  Dispatch a design agent for brand palette work, design token editing, OG image
  generation, typography decisions, and visual identity work.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:design — Design Agent

## Mandatory First Step

Read the guide before ANY work:
```
{PROJECT_ROOT}/.rdc/guides/design.md
(fallback: {PROJECT_ROOT}/.rdc/guides/design.md)
```

## Six Design Principles

1. **User/Community First** — Serving those affected by the work
2. **Stewardship, Not Ownership** — Components hold space, don't dominate
3. **Verified, Not Narrated** — Real data only; no mocks
4. **Readability at Every Gate** — Clarity scales, jargon does not
5. **Dark by Default, Never Dark by Habit** — Dark palette signals trust
6. **Machines Handle Calculation; Humans Handle Conscience**

## Token System

Two-layer model:
```
global_design_tokens (base tokens)
  + brand_token_overrides (per-brand delta)
  = TokenWithInheritance[] (resolved set)
```

Token export formats: JSON flat map, CSS vars (`:root`), other format systems.

## OG Images

| Property | Value |
|----------|-------|
| Dimensions | 1200 × 630 px |
| Format | RGB PNG, committed to git |
| Location | `apps/<app>/public/og/og-image.png` |
| Max size | 200 KB |

Metadata:
```ts
export const metadata: Metadata = {
  openGraph: {
    images: [{ url: "/og/og-image.png", width: 1200, height: 630, alt: "..." }],
  },
  twitter: { card: "summary_large_image", images: ["/og/og-image.png"] },
};
```

## Variant Axes — Every Component Must Support

| Axis | Values |
|------|--------|
| Size | xs / sm / md / lg / xl |
| Shape | sharp / soft / pill / circle |
| Density | compact / comfortable / spacious |
| Motion | static / subtle / rich |

## Animation Philosophy

- Always respect `prefers-reduced-motion` via appropriate hooks
- Token-driven durations and easing — never hardcoded values
- Keep motion purposeful, not decorative

## Safety Rules

- Never hardcode hex colors in components — CSS variables only
- Never override tokens without a design decision recorded
- Branch: development branch — auto-commit
- NEVER run `pnpm build`
