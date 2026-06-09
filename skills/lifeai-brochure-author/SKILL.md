---
name: lifeai-brochure-author
version: 0.1.0
description: |
  The mandatory contract for authoring brochure JSX using @lifeai/brochure-kit. Use this skill EVERY TIME any AI engine (Claude, Cursor, Copilot, /design, Cowork, v0) generates JSX intended for the Brochurify pipeline — whether the user says "write a brochure," "make a one-pager," "draft a PDF report," or any equivalent. Also trigger when a file imports from @lifeai/brochure-kit. Failing to read this skill before authoring is a defect.

triggers:
  - "write a brochure"
  - "make a one-pager"
  - "draft a PDF report"
  - "design a brochure"
  - "create an investor doc"
  - "generate a fact sheet"
  - "brochurify"
  - "@lifeai/brochure-kit"
  - any JSX file under apps/*/brochures/ or packages/brochure-*/

required_validators:
  - command: pnpm bk-lint
    blocking: true
---

# LIFEAI Brochure Authoring Contract

This is the contract every AI engine obeys when generating brochure JSX. The contract is non-negotiable. If you cannot generate output that complies, **stop and ask for clarification rather than emit non-compliant code.**

## The Core Rule

Every brochure is a tree composed exclusively of components from `@lifeai/brochure-kit`. Raw HTML elements (`div`, `span`, `section`, etc.) are forbidden in the page tree. There are no exceptions.

```tsx
// ❌ WRONG
<div className="flex flex-col gap-4">
  <h1 style={{color: '#2d5a3f'}}>Title</h1>
  <p>Body text...</p>
</div>

// ✅ RIGHT
<Stack gap="md">
  <Heading level={1} variant="accent">Title</Heading>
  <Prose>Body text...</Prose>
</Stack>
```

If you find yourself reaching for a `<div>`, the answer is one of: `<Stack>`, `<Cluster>`, `<Section>`, `<Columns>`, or `<Brochure>`. There is always a kit primitive for what you want.

## The Allowed Components

Exactly these. No others.

### Layout primitives
- `<Brochure>` — root wrapper. Required. Carries `theme`, `pageSize`, `mode`.
- `<Page>` — explicit page boundary. Use sparingly; prefer Sections.
- `<Section>` — semantic grouping. Carries `level`, `id`, `affinity`.
- `<Cluster>` — tightly-coupled children (heading + intro + image). Stays together when possible.
- `<Stack>` — loose vertical flow. The default container.
- `<Columns>` — multi-column block. Carries `count`, `gap`.
- `<Spacer>` — explicit air. Declared in named sizes only.

### Content primitives
- `<Prose>` — body text. Wraps paragraphs. Required for any flowing copy.
- `<Heading>` — section heading. Carries `level` (1-6), `variant`.
- `<Quote>` — pull quote. Carries `attribution`, `variant`.
- `<Stat>` — single numeric callout. Carries `value`, `label`, `variant`.
- `<StatRow>` — horizontal band of Stats. Carries `count`.
- `<DataTable>` — table. Carries `headers`, `rows`, `splitPolicy`.
- `<List>` — typed list. Carries `kind` (bullet, number, check, none).
- `<Definition>` — term + definition pair.

### Visual primitives
- `<Figure>` — image with caption. Carries `src`, `alt`, `caption`, `width`, `height`, `crop`, `bleed`.
- `<Hero>` — page-anchored hero. Carries `src`, `alt`, `placement`.
- `<Divider>` — explicit separator. Carries `variant`.

### Meta primitives
- `<Cover>` — first page, page-locked.
- `<TableOfContents>` — auto-generated from `<Heading>`s.
- `<Footnote>` — page-anchored footnote. Carries `id`, `marker`.

## The Allowed HTML (inside `<Prose>` only)

Inside `<Prose>`, these inline HTML elements are allowed:
- `<em>`, `<strong>` — emphasis
- `<a>` — links (with `href`)
- `<code>` — inline code
- `<sub>`, `<sup>` — subscript/superscript
- `<br>` — line break (use sparingly)

Anything else inside `<Prose>` is rejected.

## The Forbidden Patterns

These are hard-rejected by the validator. Do not emit them under any circumstance.

1. **Raw layout HTML** — `<div>`, `<span>`, `<section>`, `<article>`, `<aside>`, `<header>`, `<footer>`, `<nav>` outside of `<Prose>`.
2. **Inline styles** — `style={{...}}` on any element. Use variant props instead.
3. **Color literals** — Hex codes, rgb(), hsl() in JSX. Use theme tokens via variants.
4. **Viewport units** — `vh`, `vw`, `vmin`, `vmax` anywhere. Pages have fixed dimensions; viewport units break pagination.
5. **Flexbox utility classes** — `flex`, `flex-col`, `justify-*`, `items-*` directly in className. Use kit primitives that handle layout.
6. **Tailwind sizing literals** — `w-64`, `h-32`, `min-h-screen`. Use kit props.
7. **Empty containers** — `<Stack></Stack>` with no children is rejected. Use `<Spacer>` for explicit air.
8. **Nested `<Page>`** — Pages cannot contain Pages.
9. **`<Figure>` without dimensions** — Every Figure must declare `width` and `height` (in inches or as a kit named size: `xs`, `sm`, `md`, `lg`, `xl`, `full`, `bleed`).
10. **External CSS imports** — No `import './foo.css'` in brochure files. Theming is via tokens.

## The Required Props

Every brochure must:

1. Have exactly one `<Brochure>` root wrapper
2. Declare `theme` on `<Brochure>` (one of: `prt`, `place-fund`, `zoen`, `evergreen`, `editorial-neutral`)
3. Declare `pageSize` on `<Brochure>` (one of: `letter`, `a4`, `legal`, `digest`, `tabloid`)
4. Declare `mode` on `<Brochure>` (one of: `read-only`, `cosmetic`, `editorial`, `creative`)

## The Token System

All styling derives from `@lifeai/brochure-tokens`. You reference tokens via variant props, never via raw values.

```tsx
// ✅ Variant references resolve to tokens
<Heading variant="accent">...</Heading>           // → color: token.color.accent
<Stat variant="emphasis">...</Stat>               // → typography.scale.emphasis
<Stack gap="md">...</Stack>                       // → spacing.scale.md
<Figure width="lg" height="md">...</Figure>       // → kit-named sizes

// ❌ Literal references fail
<Heading style={{color: '#2d5a3f'}}>...</Heading> // hard-rejected
<Stack style={{gap: '24px'}}>...</Stack>          // hard-rejected
```

Available variant tokens depend on the theme. Common ones: `default`, `muted`, `accent`, `accent2`, `emphasis`, `serif`, `mono`. The theme file (in `packages/brochure-tokens/src/themes/`) is the authoritative list.

## Pagination Affinities

Components declare how they want to paginate. You don't manage page breaks manually except via `<Page>`. The engine does it.

| Component | Default affinity |
|---|---|
| `<Heading level=1|2>` | `preferTopOfPage` + `keepWithNext` |
| `<Heading level=3-6>` | `keepWithNext` |
| `<Cluster>` | `preferKeepTogether` |
| `<Stack>` | `breakable` |
| `<Quote>` | `preferKeepTogether` |
| `<Stat>`, `<StatRow>` | `atomic` (never split) |
| `<DataTable>` | `splitWithRepeatedHeaders` (min 3 rows per fragment) |
| `<Figure>` | `keepWithCaption` |
| `<Hero>` | `preferStandalone` page |
| `<Footnote>` | sticks to anchor page |

You can override per-instance with the `affinity` prop on most components: `affinity="breakable"`, `affinity="keepTogether"`, `affinity="hardBreakBefore"`, `affinity="hardBreakAfter"`, `affinity="preferStandalone"`.

## Worked Example 1: Investor One-Pager (Read-Only Mode)

```tsx
import {
  Brochure, Cover, Section, Cluster, Stack, Heading, Prose,
  Stat, StatRow, Figure, Footnote
} from '@lifeai/brochure-kit';

export const PrtOnePager = () => (
  <Brochure theme="prt" pageSize="letter" mode="read-only">
    <Cover>
      <Heading level={1} variant="accent">Planetary Regenerative Trust</Heading>
      <Heading level={3} variant="muted">Q3 2026 Fund Update</Heading>
      <Figure
        src="prt-cover.jpg"
        alt="Aerial view of Sky Mesa South Ranch"
        width="bleed"
        height="lg"
        affinity="preferStandalone"
      />
    </Cover>

    <Section level={1} id="overview">
      <Heading level={2}>Fund Overview</Heading>
      <StatRow count={3}>
        <Stat value="$200M" label="Target raise" variant="emphasis" />
        <Stat value="506(c)" label="Reg D structure" />
        <Stat value="3" label="Investment lanes" />
      </StatRow>
      <Cluster>
        <Heading level={3}>Five Capitals Framework</Heading>
        <Prose>
          PRT operates across the Five Capitals: <strong>Natural, Social,
          Financial, Built, and Human</strong>. Capital flows are gated by
          place-readiness rather than calendar deadlines<Footnote id="fn1" />.
        </Prose>
      </Cluster>
    </Section>

    <Section level={1} id="lanes">
      <Heading level={2}>Investment Lanes</Heading>
      <Prose>
        Three lanes accept capital with distinct return profiles, hold
        periods, and risk parameters.
      </Prose>
    </Section>

    <Footnote id="fn1" marker="1">
      Readiness gates are defined per-place by Story of Place methodology and
      reviewed by an independent stewardship council.
    </Footnote>
  </Brochure>
);
```

Things to notice:
- No `<div>` anywhere. Every container is a kit primitive.
- No styles. Every visual decision is a variant prop.
- The Figure on the cover declares `width="bleed"` (a kit-named size that resolves to full bleed at PDF time)
- The Footnote is declared inline and the actual footnote content is at the end; the engine pairs them and places the content on whatever page the anchor lands on.
- `affinity="preferStandalone"` on the cover Figure ensures the cover image doesn't fight with body content on page 1.

## Worked Example 2: Why-Us Document (Cosmetic Mode)

```tsx
import {
  Brochure, Cover, Section, Stack, Cluster, Heading, Prose, Quote,
  Figure, List, Definition, Divider
} from '@lifeai/brochure-kit';

export const WhyUsSkyMesa = () => (
  <Brochure theme="place-fund" pageSize="letter" mode="cosmetic">
    <Cover>
      <Heading level={1}>Why Us</Heading>
      <Heading level={3} variant="muted">Sky Mesa South Ranch · Aspen, Colorado</Heading>
    </Cover>

    <Section level={1}>
      <Heading level={2}>The Land Speaks First</Heading>
      <Prose>
        Before any framework or fund structure, we begin with the question:
        what is this place already trying to become? Sky Mesa South Ranch sits
        in the Roaring Fork watershed, on land with five generations of
        ranching memory and the deep ecological imprint of high-altitude
        montane ecosystems.
      </Prose>
      <Figure
        src="sky-mesa-aerial.jpg"
        alt="Sky Mesa from the eastern ridge"
        caption="Sky Mesa South Ranch, photographed in late summer 2025"
        width="lg"
        height="md"
      />
    </Section>

    <Divider variant="rule" />

    <Section level={1}>
      <Heading level={2}>Five Capitals at Sky Mesa</Heading>
      <List kind="check">
        <Definition term="Natural">Watershed restoration, riparian recovery, soil regeneration</Definition>
        <Definition term="Social">Multi-generational ranching community, Indigenous consultation</Definition>
        <Definition term="Financial">PRT Lane B with conservation easement layer</Definition>
        <Definition term="Built">Adaptive reuse of existing ranching infrastructure</Definition>
        <Definition term="Human">On-site stewardship apprenticeships starting Year 1</Definition>
      </List>
    </Section>

    <Section level={1}>
      <Quote attribution="Bill Reed, AIA LEED">
        Regeneration is not a technology applied to a place. It is a
        relationship a place enters into with the people who tend it.
      </Quote>
    </Section>
  </Brochure>
);
```

## Worked Example 3: Fact Sheet (Read-Only Mode, Dense)

```tsx
import {
  Brochure, Section, Stack, Heading, Prose,
  DataTable, StatRow, Stat
} from '@lifeai/brochure-kit';

export const FundFactSheet = () => (
  <Brochure theme="prt" pageSize="letter" mode="read-only">
    <Section level={1}>
      <Heading level={1} variant="accent">PRT Fund Fact Sheet</Heading>
      <Heading level={3} variant="muted">As of Q3 2026</Heading>
    </Section>

    <Section level={2}>
      <Heading level={2}>Performance</Heading>
      <StatRow count={4}>
        <Stat value="$185M" label="Committed capital" />
        <Stat value="$92M" label="Deployed" />
        <Stat value="12" label="Active places" />
        <Stat value="8.4%" label="Net IRR (LTM)" variant="emphasis" />
      </StatRow>
    </Section>

    <Section level={2}>
      <Heading level={2}>Capital by Lane</Heading>
      <DataTable
        headers={["Lane", "Commitment", "Deployed", "Net IRR"]}
        rows={[
          ["A — Production", "$80M", "$48M", "10.2%"],
          ["B — Place Capital", "$70M", "$32M", "7.8%"],
          ["C — Stewardship", "$35M", "$12M", "5.4%"],
        ]}
        splitPolicy="repeat-headers"
      />
    </Section>
  </Brochure>
);
```

## Pre-Flight Checklist (Run before considering output complete)

Before declaring any brochure JSX done, verify:

- [ ] Only kit components in the page tree (no raw `<div>`, `<span>`, etc.)
- [ ] No `style={{}}` attributes anywhere
- [ ] No color, rgb, hsl literals in JSX
- [ ] No `vh`, `vw` viewport units
- [ ] Every `<Figure>` has `width` and `height`
- [ ] Exactly one `<Brochure>` root
- [ ] `theme`, `pageSize`, `mode` all set on `<Brochure>`
- [ ] All Quotes inside `<Quote>` (not raw HTML)
- [ ] All flowing text inside `<Prose>`
- [ ] No empty containers
- [ ] No nested `<Page>`
- [ ] Run `pnpm bk-lint <file>` — exit code 0

If any check fails, fix it before completing. The validator is the contract; this skill is the lookup table.

## When Things Get Hard

If you genuinely cannot express something in kit primitives, **stop and surface the gap.** Don't reach for `<div>`. Either:

1. The kit needs a new component (file as a Phase-2 enhancement)
2. The content is wrong for this format (push back on the user)
3. There's a kit primitive you missed (re-read this skill)

The first two are honorable. Reaching for `<div>` is not.
