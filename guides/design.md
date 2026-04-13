# Design Agent Guide — Base
> Role-based context for design system, branding, and visual agents. Generic patterns across projects.

---

## Design Principles

Projects typically define core design principles. Check the overlay for:
- Philosophy guiding all visual decisions
- Accessibility standards
- Motion/animation philosophy
- Dark/light mode strategy
- Tone and voice guidelines

---

## Brand Palettes

The project specifies:
- Primary colors per brand
- Accent/secondary colors
- Neutrals and grays
- Dark mode vs light mode variations
- Color semantics (error, success, warning, etc.)

Check the overlay for exact hex values and CSS variable names.

---

## Token Inheritance / Design Tokens

Some projects use design token systems. The overlay specifies:
- Whether tokens are centralized or distributed
- How tokens are versioned
- Export formats (JSON, CSS, Figma, etc.)
- Token hierarchy and relationships

---

## Typography

The project specifies:
- Primary UI font(s)
- Display/heading font
- Mono font for code
- Type scale (sizes and weights)
- Line heights and letter spacing

Never hardcode `font-family` — always use tokens or CSS variables.

---

## Component Variant Axes

Most design systems define variant axes. Check overlay for which axes apply:
- Brand / product line
- Visual style (default, minimal, heritage, etc.)
- Size and density
- Shape (rounded, sharp, pill, etc.)
- Motion (static, subtle, rich)
- State (default, hover, disabled, etc.)

Every component should support relevant axes on day one.

---

## OG Images / Social Cards

The project specifies:
- Dimensions (1200×630 is standard)
- Format (PNG, JPG)
- Design spec (fonts, colors, layout)
- Generation process (Python/Pillow, Node, etc.)
- File location and naming convention

---

## Asset Organization

The project specifies:
- Where to store images (folder structure)
- Naming convention (kebab-case patterns)
- File formats (WebP for photos, SVG for icons, etc.)
- Optimization requirements

---

## Animation and Motion

The project specifies:
- Whether animations are used (CRUD vs public pages)
- Motion library (Framer, Aceternity, custom, etc.)
- Easing and duration tokens
- `prefers-reduced-motion` compliance

---

## Accessibility

The project specifies:
- WCAG compliance level (A, AA, AAA)
- Color contrast requirements
- Focus indicators
- Keyboard navigation patterns
- Screen reader expectations

---

## Specialist Context — Read Project Overlay

Your task may require reading additional project-specific guides for:
- Brand system architecture (token inheritance, export)
- OG image generation scripts
- Design token tools and workflows
- Specific app brand palettes
- Component inventory and patterns
