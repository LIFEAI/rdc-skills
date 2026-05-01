# Rampa CLI Reference for RDC Design

Rampa is CLI support for agent-side color-system design. It is not the Studio palette UI and does not replace Studio's Palette Library or token tables.

## Preflight

Prefer `npx` so agents do not depend on a global install:

```powershell
npx @basiclines/rampa --help
```

If installed globally:

```powershell
rampa --help
```

## Usage Rules

- Use Rampa to generate proposals, not to write production tokens directly.
- Map every accepted output into Studio token roles or Palette Library payloads.
- Check contrast before recommending text/background pairs.
- Avoid pure `#000` and `#fff` as final RDC design tokens.
- Preserve locked/governance tokens.

## Recipes

### Theme Foundation

```powershell
npx @basiclines/rampa -C "#548235" -L 95:10 --size=10 -O css --name=primary
npx @basiclines/rampa -C "#548235" --add=complementary -L 95:10 --size=10 -O css --name=secondary
npx @basiclines/rampa -C "#548235" -L 98:5 -S 5:10 --size=10 -O css --name=neutral
```

Map into Studio roles:

- `primary` -> primary palette seed / `--color-primary`
- `secondary` -> secondary palette seed / `--color-secondary`
- `neutral` -> surface, text, border, muted roles after contrast review

### Tinted Neutrals

```powershell
npx @basiclines/rampa -C "#548235" -L 98:5 -S 5:10 --size=10 -O json --name=neutral
```

Use for background, surface, elevated, border, muted text, and disabled states. Keep chroma low near lightness extremes.

### Status Colors

```powershell
npx @basiclines/rampa -C "#548235" --add=square -L 95:15 --size=10 -O css --name=status
```

Map hues deliberately:

- green/teal -> success
- yellow/orange -> warning
- red/pink -> danger
- blue/cyan -> info

### Data Visualization

```powershell
npx @basiclines/rampa -C "#548235" --add=triadic --size=2 -L 50:50 -S 70:70 -O css --name=chart
npx @basiclines/rampa -C "#548235" --add=square --size=2 -L 50:50 -S 70:70 -O css --name=chart
```

Use fixed lightness for equal visual weight. Avoid turning chart palettes into ramps unless the data is ordinal.

### Contrast Lint

```powershell
npx @basiclines/rampa lint --fg "#123123" --bg "#f7faf3"
npx @basiclines/rampa lint --fg "#123123" --bg "#f7faf3" --mode wcag --output json
```

Record contrast failures in the design output. Do not bury them as "subjective" design concerns.

## Studio Mapping Checklist

Before persistence:

- identify brand/entity
- identify palette seed roles
- map generated ramps to Studio token names
- validate light and dark values
- check text/background contrast pairs
- save through Studio Palette Library or token apply service
- verify `/api/v2/tokens/[slug]/css` changes as expected
