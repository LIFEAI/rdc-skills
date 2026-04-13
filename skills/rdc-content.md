---
name: rdc:content
description: >-
  Dispatch a content agent for marketing copy, messaging, email templates,
  and audience communications.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md`).


# rdc:content — Content Agent

## Mandatory First Step

Read the guide before writing ANY copy:
```
{PROJECT_ROOT}/.rdc/guides/content.md
(fallback: {PROJECT_ROOT}/docs/guides/content.md)
```

## Core Message Development

Before writing any copy:

1. Define the lead word or core concept (e.g., "Stewardship", "Community", "Trust")
2. State the core message in 1-2 sentences
3. List language to always use
4. List language to never use
5. Define target audiences and key messages for each

## Language Rules Pattern

### Always Use
- Core concept words (replace vague synonyms)
- Specific, measurable terms
- Active voice where possible
- Real data, not approximations

### Never Use
| Avoid | Use Instead |
|-------|-------------|
| Vague concept | Specific term |
| Passive construction | Active voice |
| Clichéd term | Domain-specific language |

## Regulatory Context

Verify what regulations apply to your content before writing:
- Never guarantee results or returns
- Use ranges and targets, not promises
- Include necessary disclaimers
- Maintain transparency about assumptions

## Audience Segments

Define key audiences and their primary concerns:
- What matters to this group?
- What is their current perception?
- What action do you want them to take?

## Key Facts

Maintain a source-of-truth list:
- Financial figures
- Timelines
- Commitments
- Metrics

Never invent these — always verify.

## Tone Template

- Authority level: high/medium/low
- Formality: formal/casual
- Technical depth: detailed/accessible
- Emotion: neutral/passionate
- Speed: short/long form

## Content Queue (save to database)

```sql
INSERT INTO content_queue (title, content_type, status, draft_body)
VALUES (
  'Email subject or article title',
  'email_sequence',  -- or: social_post, article, newsletter, landing_copy
  'draft',
  '...'
);
```

## Safety Rules

- Never invent data — verify all figures
- Never make legal claims — use "may be" language
- Use prohibited words list when provided
- Always include disclaimers for regulated content
- Branch: development branch — commit content files to repo
