# Studio Model for RDC Design

Studio is the token authority and live website editor for LIFEAI brands. It is not a page builder. The design skill must work with Studio's real routes, APIs, token tables, and editor/debug model.

## Required Source Docs

Read these before Studio design work:

- `docs/systems/studio/ARCHITECTURE.md`
- `apps/studio/CLAUDE.md`
- `.claude/context/design-system-global.md`

## Runtime Locations

- local Studio: `http://localhost:3011`
- staging Studio: `https://staged.studio.regendevcorp.com`
- production Studio: `https://studio.regendevcorp.com`

## Brand Pages

- `/brands`
- `/brands/new`
- `/brands/[id]/colors`
- `/brands/[id]/typography`
- `/brands/[id]/spacing`
- `/brands/[id]/diff`
- `/brands/[id]/book`
- `/brands/[id]/voice`
- `/brands/[id]/assets`
- `/brands/[id]/export`
- `/brands/[id]/table-styles`

## Editor Routes

- `/editor`
- `/editor/local/[brandSlug]`
- `/editor/local-test-target`
- legacy `/editor/[brandSlug]` may redirect to local editor unless `?legacy=1`

Read local debug docs:

- `docs/systems/studio/local-debug-agent.md`

Clauth relay route families:

- `/studio/debug/*`
- `/studio/claude/*`

## Native Local Debug Model

Studio live editing must use the RDC-owned local debug system, not an external live-edit runtime:

1. Studio starts a local session with `POST /studio/debug/start`.
2. Studio embeds the returned local `devUrl` with debug query params.
3. `/api/editor/local-debug` injects Studio's own `local-debug-browser.js` picker.
4. Browser/user events go to `/studio/debug/:sessionId/events`.
5. Claude Code polls `/studio/claude/:sessionId/poll` with `scripts/studio-debug-poll.mjs`.
6. Claude edits source files directly and replies to `/studio/claude/:sessionId/reply`.
7. HMR updates the iframe.

The disposable proof target is:

- `/editor/local/test`
- `apps/studio/src/app/editor/local-test-target/page.tsx`

Direct edits must make exactly one source edit unless impossible. Variant edits should return alternatives without editing unless explicitly instructed to apply one. Reference replacement requires an explicit reference. Notes must not edit source.

## Token APIs

- `GET /api/public/tokens/[slug]` returns legacy public token payload and CSS variables.
- `GET /api/v2/tokens/[slug]` returns DTCG/M3 token JSON.
- `GET /api/v2/tokens/[slug]/css` returns shadcn-compatible CSS vars.

Palette APIs currently start here:

- `apps/studio/src/app/api/palettes/route.ts`
- `apps/studio/src/app/api/palettes/apply/route.ts`

## Canonical Tables

Current token and theme work should prefer v2 where available:

- `global_design_tokens_v2`
- `brand_token_overrides_v2`
- `brand_semantic_tokens`
- `brand_components`
- `brand_patterns`
- `token_inheritance_audit`

Legacy/current website token tables:

- `brand_token_overrides`
- `brand_font_assignments`
- `brand_fonts`

Legacy read-only or migration tables:

- `global_design_tokens`
- `brand_colors`
- `brand_typography`
- `brand_spacing`

Docs/narrative:

- `brand_design_docs`

Registry/hierarchy:

- `brand_entities`
- `org_entities`

## Key Files

- `apps/studio/src/contexts/BrandStudioContext.tsx`
- `apps/studio/src/lib/token-resolver.ts`
- `apps/studio/src/lib/token-resolver-v2.ts`
- `apps/studio/src/lib/token-export.ts`
- `packages/design-tokens/src/types.ts`
- `packages/ui/src/components/WebsiteLayout.tsx`
- `packages/ui/src/styles/website-base.css`

## BrandStudioContext

Child pages under `/brands/[id]/*` should use `useBrandStudio()` instead of re-fetching tokens. It provides:

- `brand`
- `resolved`
- `setResolved`
- `globals`
- `overrides`
- `loaded`

## Token Rules

- Use Studio tokens for every production design decision.
- Never invent a brand slug. Query `brand_entities`.
- Never modify locked governance tokens without an explicit governance decision.
- Missing token protocol: create a work item, use closest existing token temporarily, and mark the gap.
- Production code should use `var(--color-*)` or resolved Studio token output.

## Palette Designer Boundary

The forked Palette Designer is a separate tool. Studio should launch it only when installed/enabled/healthy. It should load and save through Palette Library APIs, then Studio should reflect saved palettes.

Do not rebuild Palette Designer inside the colors page in the first pass.

## Deprecated Routes

Do not extend:

- `/api/editor/render`
- `/api/layout/scan` unless maintaining legacy scanner behavior
- `/api/layout/sync`
