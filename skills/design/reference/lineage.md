# RDC Design Lineage

RDC Design is inspired by and adapted from the Impeccable design workflow. Upstream Impeccable remains installed separately and untouched.

## Rules

- Keep the installed Impeccable skill available for direct use.
- Do not rename or overwrite installed Impeccable files.
- Do not create a second skill named `impeccable`.
- Use `rdc:design` for RDC, Studio, token, Palette Library, Rampa CLI, and LIFEAI interface work.
- Preserve third-party license and notice files if source material is forked or vendored.

## Attribution Text

Use this attribution in docs or NOTICE files when the implementation materially derives from Impeccable:

```text
RDC Design is inspired by and adapted from the Impeccable design workflow by Paul Bakaus.
Upstream Impeccable remains a separate installed skill.
```

## Practical Boundary

Concepts such as audit, polish, colorize, shape, craft, and anti-pattern checks are useful workflow patterns. RDC Design replaces the generic project model with RDC-specific knowledge:

- Studio as token authority
- Palette Library as palette persistence boundary
- Rampa CLI as proposal tooling
- RDC work-item protocol
- local Studio editor/debug routes
- real LIFEAI app and package paths
