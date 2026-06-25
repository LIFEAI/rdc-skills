---
name: rdc:channel-formatter
description: "Usage `rdc:channel-formatter <channel|pack> [content]` — Apply precise, channel-native formatting and content repurposing to any output: LinkedIn, Twitter/X, Slack/Teams, Email (external/internal), Pitch Deck slides, Word/DOCX, PDF Report, Web/Landing Page, and multi-output content packs. Use EVERY TIME the user names an output channel/platform/document type, asks to 'write a post', 'draft an email', 'format this for', 'make this a slide', 'send to LinkedIn', 'write a tweet', 'social media post', 'turn this article into posts', 'make a content pack', 'make a social pack', or 'repurpose this article'. Each channel has its own Unicode strategy, emphasis system, length limits, and structure — never apply generic markdown to channel-specific output. This skill FORMATS, STRUCTURES, and REPURPOSES text only — for actual .docx/.pptx ↔ Markdown FILE conversion (either direction) use `rdc:convert` (build-corpus), not this skill. Self-contained: all channel and pack rules are inlined below (no external reference files)."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> The formatted deliverable IS the output. Produce the channel-correct text directly.
> No tool-call narration, no raw markdown wrappers around channel output, no log dumps.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. It writes no files and makes no external calls; under `RDC_TEST=1` behavior is unchanged (pure text transform).

# Channel Formatter

Format or repurpose output precisely for the target channel. This skill is
**self-contained** — every channel and pack rule is inlined below. Detect the
channel or pack, jump to its section, apply its rules exactly. Never apply
generic markdown to a channel that doesn't render it.

---

## When to Use

Use this skill whenever the user asks to write, format, adapt, or repurpose
content for a specific channel, platform, document type, or output pack.

Common triggers:
- "write a LinkedIn post"
- "turn this article into social posts"
- "make a content pack"
- "make a social pack"
- "repurpose this article"
- "write a tweet/thread"
- "draft an email"
- "format this for Slack"
- "make this a slide"
- "write landing-page copy"

Do not use this skill for binary file conversion, PDF rendering, Brochurify
orchestration, or brochure JSX authoring; delegate those to the specialist
skills named in the scope boundary.

## Arguments

`rdc:channel-formatter <channel|pack> [content]`

- `<channel|pack>`: optional target such as `linkedin`, `twitter`,
  `twitter-thread`, `slack`, `email-ext`, `email-int`, `pitch-deck`, `word`,
  `pdf-report`, `web`, `strict-format`, `social-pack`, `campaign-pack`,
  `exec-pack`, or `launch-pack`.
- `[content]`: optional source text, path reference, article, report, transcript,
  rough draft, or surrounding conversation content.

## Channel Detection

| If user says / context is...                          | Channel          | Go to section            |
|-------------------------------------------------------|------------------|--------------------------|
| LinkedIn, post, share on LinkedIn                     | LinkedIn         | [§ LinkedIn](#-linkedin) |
| Tweet, Twitter, X post, thread                        | Twitter/X        | [§ Twitter / X](#-twitter--x) |
| Slack, Teams, Discord, chat message                   | Slack/Teams      | [§ Slack / Teams](#-slack--teams) |
| Email to client/investor/external, cold outreach      | Email (External) | [§ Email — External](#-email--external) |
| Email to team, internal, Slack alternative            | Email (Internal) | [§ Email — Internal](#-email--internal) |
| Pitch deck, slide, investor slide, one-pager slide    | Pitch Deck       | [§ Pitch Deck](#-pitch-deck) |
| Word, DOCX, document, report, memo, letter, contract  | Word/DOCX        | [§ Word / DOCX](#-word--docx) |
| PDF report, annual report, white paper                | PDF Report       | [§ PDF Report](#-pdf-report) |
| Website, landing page, web copy                       | Web/Landing Page | [§ Web / Landing Page](#-web--landing-page) |
| Artifact, JSX, React component, Claude artifact       | Artifact/JSX     | → use the `jsx-author` / `impeccable` skill instead |

### Pack Detection

| If user says / context is...                          | Mode             | Go to section                 |
|-------------------------------------------------------|------------------|-------------------------------|
| social pack, content pack, posts from this, repurpose this article for social | `social-pack` | [§ Content Repurposing Packs](#-content-repurposing-packs) |
| campaign pack, launch campaign, article into email + social + web | `campaign-pack` | [§ Content Repurposing Packs](#-content-repurposing-packs) |
| exec pack, executive pack, leadership summary, internal briefing | `exec-pack` | [§ Content Repurposing Packs](#-content-repurposing-packs) |
| launch pack, announce this, launch posts              | `launch-pack`    | [§ Content Repurposing Packs](#-content-repurposing-packs) |
| strict format, preserve wording, do not rewrite       | `strict-format`  | [§ Repurposing Modes](#-repurposing-modes) |

---

## Workflow

1. **Detect channel or pack mode** from the request using the tables above.
2. **Classify the source**: already-drafted copy, long article/report, transcript, notes, or brief.
3. **For long sources**, extract thesis, audience, proof points, CTA, constraints, and factual risks before writing.
4. **Jump to the target channel or pack section** below and apply all rules exactly — do not rely on memory.
5. **Never mix** markdown conventions across channels.
6. If the channel or pack is ambiguous, ask once: "Is this for [Channel A] or [Channel B]?"
7. Produce the formatted or repurposed output directly as the deliverable.

## Hard Rules (all channels)

- Never apply generic markdown (`##`, `**`, `-`, etc.) to LinkedIn, Email, Slack, or Twitter output.
- Never use raw LaTeX in LinkedIn, Email, Slack, or Twitter — use Unicode math symbols.
- Never use Word Styles notation in plain-text channels.
- Always match the tone register of the channel (formal ≠ casual ≠ punchy).
- For LIFEAI/PRT/RDC content, maintain REGEN-MODE voice unless Author-Mode is active.
- When repurposing a long source, preserve the source thesis and never invent unsupported statistics, quotes, names, dates, citations, results, or commitments.
- If the source lacks a needed CTA, audience, proof point, or date, either use a clearly generic placeholder or state the assumption before the polished output.

> ## ⛔ Scope boundary — this skill FORMATS text; it does NOT convert files
> This skill governs **how to structure and format content** for a channel. It never
> reads or writes binary office files. For the actual **Word ↔ Markdown (and .pptx/.ppt)
> file conversion — in either direction — use `build-corpus` / the `rdc:convert` skill**,
> never this one. So: "convert this .docx to markdown" / "turn this markdown into a Word
> doc" → **`rdc:convert`**. "format this content the Word way / write it for LinkedIn" →
> this skill. The Word/DOCX and PDF sections below describe target structure only; producing
> the actual `.docx`/`.pdf` artifact is `rdc:convert` / `rdc:brochure`, not channel-formatter.
>
> Specialist routing:
> - Office/Markdown file conversion → `rdc:convert`
> - HTML/folder/zip/URL to PDF brochure rendering → `rdc:brochure`
> - Brochurify orchestration jobs → `rdc:brochurify`
> - Brochure JSX using `@lifeai/brochure-kit` → `lifeai-brochure-author`

---

## § Repurposing Modes

Use these modes when the input is longer than the requested output, such as an
article, memo, transcript, report, rough draft, or notes.

### `strict-format`
Preserve the source wording and argument as much as the channel allows. Use this
when the user says "format only", "do not rewrite", "preserve wording", or when
legal/compliance precision matters. You may adjust line breaks, headings,
emphasis, bullet symbols, and channel-specific structure, but do not add new
claims or reframe the argument.

### `single-channel`
Repurpose the source into one target channel. Extract the usable argument,
choose the strongest hook for that channel, compress or expand to the channel's
native length, and produce one finished output.

### `social-pack`
Repurpose one source into a coordinated set of social outputs:
- LinkedIn thought-leadership post
- Short LinkedIn announcement or teaser variant
- Twitter/X single post
- Twitter/X thread
- Slack/Teams internal share

### `campaign-pack`
Repurpose one source into a small campaign kit:
- Everything in `social-pack`
- External email intro/blurb
- Web excerpt
- SEO meta title and meta description
- 3 CTA variants

### `exec-pack`
Repurpose one source for internal leadership alignment:
- Internal email summary
- Slack/Teams update
- Executive-summary paragraph
- 3 talking points
- Decision/ask line if the source supports one

### `launch-pack`
Repurpose one source for an announcement:
- LinkedIn launch post
- Twitter/X launch post
- Slack/Teams launch note
- External email blurb
- Web hero headline/subheadline/CTA
- 3 CTA variants

### Long-Source Extraction Checklist
Before writing from a long source, identify:
- **Thesis:** the central argument or announcement
- **Audience:** who this is for
- **Proof:** facts, examples, data, names, dates, or quotes explicitly present
- **CTA:** what the reader should do next
- **Tone:** formal, conversational, punchy, executive, regenerative, etc.
- **Constraints:** length, compliance, brand voice, channel quirks
- **Gaps:** missing proof, missing CTA, unsupported claims, unclear audience

### Source-Fidelity Rules
- Do not invent statistics, dates, quotes, citations, partnerships, revenue,
  legal claims, customer names, or outcomes.
- Do not upgrade tentative language into certainty.
- Do not turn illustrative examples into facts.
- Preserve caveats when they affect meaning.
- If a stronger hook needs a proof point the source does not provide, write a
  proof-neutral hook instead.
- When assumptions are material, include a short "Assumptions:" line before the
  deliverable rather than burying uncertainty in polished copy.

---

## § Content Repurposing Packs

When a pack is requested, label each output clearly and make every item
channel-native. A pack is not a generic summary repeated in several lengths.

### `social-pack` Output Shape
1. `LinkedIn thought-leadership post` — 900-1300 characters, hook-first, white space, Unicode emphasis only when useful, up to 3 hashtags.
2. `LinkedIn short variant` — 400-700 characters, announcement or teaser style.
3. `Twitter/X single post` — 265 characters or fewer unless the user asks otherwise.
4. `Twitter/X thread` — 5-7 tweets, each self-contained and below 280 characters.
5. `Slack/Teams internal share` — 3-6 lines, direct, with a clear FYI/action/decision framing.

### `campaign-pack` Output Shape
1. Full `social-pack`
2. `External email intro` — subject line plus 80-150 word blurb with one ask
3. `Web excerpt` — 80-120 words, scannable, CTA-ready
4. `Meta title` — 50-60 characters
5. `Meta description` — 150-160 characters
6. `CTA variants` — 3 verb-led CTAs

### `exec-pack` Output Shape
1. `Internal email summary` — subject plus 6-12 lines
2. `Slack/Teams update` — 3-5 lines
3. `Executive summary paragraph` — 100-150 words
4. `Talking points` — 3 concise bullets/fragments
5. `Decision or ask` — one line, only if supported by source

### `launch-pack` Output Shape
1. `LinkedIn launch post` — announcement structure
2. `Twitter/X launch post` — single post
3. `Slack/Teams launch note` — internal update
4. `External email blurb` — subject plus short body
5. `Web hero` — headline, subheadline, CTA
6. `CTA variants` — 3 options

### Pack Quality Rules
- Vary hooks by channel; do not repeat the same first sentence everywhere.
- Keep the source thesis consistent across all outputs.
- Adapt CTA strength to the channel: softer on thought leadership, direct in
  email/web, concise in Slack.
- Use channel-specific formatting rules from the sections below.
- If source proof is weak, use curiosity and framing instead of inflated claims.

---

## § LinkedIn

### Core Principles
- No markdown whatsoever — LinkedIn renders it as raw symbols.
- Unicode is the ONLY way to achieve bold, italic, and special emphasis.
- Emoticons are structural tools, not decoration — use them as bullet replacements and section markers.
- Hook in line 1 — LinkedIn truncates after ~2 lines before "see more".
- White space is content — single-line breaks create rhythm and readability.

### Unicode Character Sets
**Bold (Mathematical Bold)** — key terms, company names, headlines, CTAs:
```
𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭
𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇
𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵
```
**Italic (Mathematical Italic)** — emphasis, quotes, sub-themes:
```
𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡
𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻
```
**Bold Italic:**
```
𝘼𝘽𝘾𝘿𝙀𝙁𝙂𝙃𝙄𝙅𝙆𝙇𝙈𝙉𝙊𝙋𝙌𝙍𝙎𝙏𝙐𝙑𝙒𝙓𝙔𝙕
𝙖𝙗𝙘𝙙𝙚𝙛𝙜𝙝𝙞𝙟𝙠𝙡𝙢𝙣𝙤𝙥𝙦𝙧𝙨𝙩𝙪𝙫𝙬𝙭𝙮𝙯
```
**Math / Equations** — Unicode symbols, never LaTeX: `× ÷ ± ≠ ≤ ≥ ≈ ∴ ∵ Σ Δ α β ∞ √ ² CO₂ H₂O → ← ⟺ % °`
Example: instead of `E = mc^2` write `E = mc²`; instead of `\alpha_{PRT}` write `αPRT`.

### Emoticons as Structure
Section openers / bullets: 🔹 primary · 🔸 secondary · ▸ tertiary · ✅ result · ❌ contrast · ⚡ urgency · 🌱 regenerative (LIFEAI/PRT) · 💡 insight · 📌 takeaway · 🔑 key · 📊 data · 🏗️ development · 🤝 partnership · 💰 capital · 🌍 planetary.
Dividers: `——————————————` · `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬` · `· · · · · · · · · · · · · ·`

### Post Structure
**Standard (thought leadership):** hook line (no period, open loop) → blank → 3-6 short paragraphs (1-3 lines), emoticons as bullets → blank → insight/contrast line → blank → CTA (question/invitation) → blank → up to 3 hashtags.
**Announcement:** bold Unicode headline → what it is (2 sentences) → 🔹×3 key points → why it matters → CTA/link → 1-2 tags.
**Regenerative / LIFEAI (Dave voice):** manifesto opener (one line) → blank → problem with the old way (2-3 lines) → blank → 🌱 what we're building / how it differs / who it serves → blank → the stakes (one line) → blank → direct personal invitation → blank → `𝗗𝗮𝘃𝗲 𝗟𝗮𝗱𝗼𝘂𝗰𝗲𝘂𝗿 | LIFEAI | 𝘓𝘪𝘧𝘦 𝘣𝘦𝘧𝘰𝘳𝘦 𝘗𝘳𝘰𝘧𝘪𝘵𝘴` → `#RegenerativeCapital #PlaceRegeneration #LIFEAI`.

### Length
Thought leadership 900–1300 chars · Announcement 400–700 · Hot take 200–400 · Long-form native 1200–2000 words.

### Do NOT
❌ `**bold**` (literal asterisks) · ❌ `# Heading` (literal hash) · ❌ `-`/`•` bullets (use emoticons) · ❌ LaTeX · ❌ >5 hashtags · ❌ tagging people unless asked · ❌ walls of text (max 3 lines/paragraph).

---

## § Twitter / X

### Core Principles
- 280 characters hard limit per tweet. Hook is everything — first 5 words decide readership.
- Threads are for depth; single tweets for punchy takes. No markdown renders — plain text only.
- Minimal hashtags (1-2 max, only if genuinely searchable). End with a provocation/question when possible.

### Character Counting
- URLs always count as 23 chars (t.co). Media doesn't count. Line breaks = 1 char each. Leave a 10-15 char buffer — aim for 265 max.

### Single Tweet Structure
**Hot take:** provocative opener (≤10 words) → the turn/evidence (1-2 lines) → the landing.
**Announcement:** bold claim first → why it matters (1 line) → link/CTA.
**Regenerative (Dave):** manifesto line → old way vs new way → the invitation.

### Thread Structure
Tweet 1 = strongest hook (number `(1/7)` or use 🧵) → tweet 2 = context → tweets 3-n = one idea each → last tweet = recap + CTA/question. Each tweet must stand alone. Max 7-10 tweets — longer = blog post.

### Hook Formulas
Contrarian ("Most investors are wrong about regenerative land.") · Hard number ("We just unlocked $40M in stranded rural capital.") · Open loop ("Something broke in ESG investing. Here's what it missed:") · Bold declaration · Question · List tease ("3 things institutional capital gets wrong about place:").

### Hashtags & Emoji
Max 2 hashtags, end of tweet only, active communities only. Preferred LIFEAI tags: `#RegenerativeCapital #PlaceRegeneration #ImpactInvesting #RegenFinance`. Emoji 1-2 max as punctuation: 🌱 regen · 💰 capital · 🏗️ development · ⚡ urgency.

### Do NOT
❌ markdown · ❌ hashtag spam · ❌ "RT if you agree" · ❌ threads >10 tweets · ❌ passive openers ("I wanted to share…") · ❌ tagging without reason · ❌ ever exceed 280 chars (always count).

---

## § Slack / Teams

### Core Principles
- Brevity is respect (people read on their phone). One message = one thought. Use threads. Emoji are punctuation, not decoration.

### Slack Markdown (actually renders)
Bold `*bold*` · Italic `_italic_` · Strikethrough `~strike~` · Inline code `` `code` `` · Code block ```` ``` ```` · Blockquote `> text` · Bullets `• item`.
Note: `**bold**` (double asterisk) does NOT render in Slack — use single `*bold*`.

### Length
Quick question 1-2 lines · Status update 3-5 lines (bullets if 3+ items) · Decision request 5-8 lines · anything longer → thread or doc link.

### Structure by Type
**Question:** `Quick question on [topic] — [one-sentence question]?`
**Status update:** `*[Project]* update:` then `• Done: …` `• In progress: …` `• Blocked on: … — need [thing] from [person]`.
**Decision needed:** `Need a call on [topic] by [time].` → `Context: …` → `Options: A) … B) …` → `My lean: …` → `[@person] — your call.`
**Async FYI:** `FYI: [what happened] — no action needed. [link]`

### Emoji as Punctuation
✅ done/approved · ❌ no/blocked · 🔁 in progress · 👀 reviewing · 🙋 I'll take it · 📌 important · ⚡ urgent · 🤔 needs discussion · 💬 let's talk · 🔗 link follows.

### Do NOT
❌ walls of text (use a doc) · ❌ `**double asterisk bold**` · ❌ formal greetings ("Hi team, I hope everyone…") · ❌ passive asks ("Would anyone be able to…" → "Can you [name]…") · ❌ emoji overload (max 2-3) · ❌ cross-posting the same message.

---

## § Email — External

### Core Principles
- Plain prose, no markdown. Subject line determines open rate. First sentence justifies the email. One ask per email. Short paragraphs (2-4 sentences). Formal but human.

### Structure
`Subject:` → greeting (`Dear [First Name],`) → opening (1 sentence: context/connection) → body (¶1 reason, ¶2 value/evidence, ¶3 the one ask) → forward-looking closing line → sign-off, full name, title, org, 2-3 contact lines.

### Subject Lines
6-10 words; personalize. Cold: `[hook] — [value]` ("Regenerative capital for [Property]"). Follow-up: `Following up — [topic]`. Intro: `Introduction: [name] — [relevance]`. Request: `[Action] request — [context]`. Never use "Quick question" / "Checking in" / "Hope you're well" as a subject; never all caps.

### Tone by Recipient
Institutional/Family Office → formal, precise, lead with thesis + data · Foundation → warm, lead with impact · Government → neutral, process-oriented · Legal → exact, every claim qualified · Peer → professional, warmer · Media → newsworthy first.

### Openers (use/adapt)
"I'm reaching out because [specific reason tied to them]." · "We met at [event] — following up on [topic]." · "[Mutual contact] suggested I reach out regarding [topic]." Never open with "I hope this email finds you well." / "My name is X and I work at Y." / "I wanted to reach out to…".

### Closings & Sign-offs
"I'd welcome a 20-minute call at your convenience." / "Would you be open to a brief call this week or next?" Sign-offs: Respectfully / Yours sincerely (most formal) · Kind regards / Best regards (standard) · Warm regards (warm) · "In service of place," / "Regeneratively," (LIFEAI/Dave).
LIFEAI signature: `Dave Ladouceur` / `Founder, LIFEAI | Place Regeneration Trust` / `dave@life.ai | lifeai.com` / `Life before Profits.`

### Length
Cold outreach 150–250 words · Follow-up 80–150 · Proposal intro 250–400 · Investor update 300–500.

### Do NOT
❌ markdown · ❌ walls of text · ❌ >1 ask · ❌ passive voice on the ask · ❌ sycophantic openers/closers · ❌ unspecified attachments.

---

## § Email — Internal

### Core Principles
- Short, direct, action-oriented. Bullets fine and often preferred. Scannable subject. One topic per email. No pleasantries unless warranted.

### Structure
`Subject: [Action word] — [Topic]` (e.g. "Decision needed — Supabase migration") → optional 1-line context → direct body (2-4 short paragraphs or bullets) → clear next step on its own line → casual sign-off (Thanks / Dave / —D).

### Subject Prefixes (use consistently)
`ACTION:` recipient must do something · `DECISION:` approval/choice needed · `FYI:` informational · `URGENT:` same-day · `QUESTION:` single question · `UPDATE:` status. Example: `ACTION: Review PRT NAV calc before Friday`.

### Bullets & Tone
One idea per bullet, max 1 line, lead with the verb (Review… / Confirm… / Send…), no sub-bullets unless necessary. Direct without blunt; no "per my last email" energy; emoji sparingly.

### Length
Quick update 3-6 lines · Task assignment 6-12 · Internal brief ≤12-20 (longer → a doc).

### Do NOT
❌ markdown · ❌ long preambles · ❌ CC-ing everyone · ❌ "as per my previous email" · ❌ formal sign-offs internally.

---

## § Pitch Deck

### Core Principles
- One slide, one job. Headline IS the message (a statement, not a label). 3 bullets max. No prose on slides (sentences → speaker notes). Visual-first language. Investor slides lead with thesis, support with evidence.

### Slide Anatomy
Headline (full sentence takeaway, 12-15 words) → visual/data area (chart/diagram/table) → ≤3 bullets (fragments, not sentences) → source/footnote if cited (small, bottom-right).

### Headlines Are Assertions, Not Labels
❌ "Market Opportunity" → ✅ "A $4T regenerative land market with no institutional gateway" · ❌ "Our Solution" → ✅ "PRT converts stranded land assets into regenerative yield" · ❌ "The Team" → ✅ "30 years of place-based development across 3 continents" · ❌ "Financial Returns" → ✅ "8–12% cash yield with embedded ecological appreciation".

### Standard Deck Architecture (PRT/LIFEAI)
1 Cover · 2 The Problem · 3 The Opportunity (market + gap) · 4 Our Solution · 5 How It Works (process diagram) · 6 Traction/Proof · 7 Market/TAM · 8 Business Model · 9 Financial Projections · 10 Capital Structure (A/B/C sleeves) · 11 The Team · 12 The Ask (amount, use of funds, timeline) · 13 Appendix.

### Visual & Bullet Style
Describe visuals explicitly, e.g. `[VISUAL: horizontal capital-stack diagram — Lane A Senior Secured $Xm 6% DAF | Lane B Mezz $Xm 9% Family Office | Lane C Equity $Xm carry GP]`. Bullets: fragments, no periods, lead with metric ("8–12% cash yield") or verb ("Converts stranded assets…"), max 8 words.
Speaker notes: full conversational sentences expanding the slide — `[SPEAKER NOTE: …]`.
Typography (for JSX/design): Headline 28-36pt bold · Bullets 18-22pt · Data labels 14-16pt accent · Source 10-11pt gray · Section label 11-12pt caps.

### Do NOT
❌ prose on slides · ❌ >3 bullets · ❌ label headlines · ❌ >2 font sizes in bullet area · ❌ generic stock-photo descriptions · ❌ animations unless requested.

---

## § Word / DOCX

> **This section = how to STRUCTURE Word content (Styles, hierarchy, tables).** To
> generate an actual `.docx` file, or convert `.docx ↔ .md`, hand off to **`rdc:convert`
> (build-corpus)** — channel-formatter does not produce or parse binary files.

### Core Principles
- All formatting via **Word Styles** (never raw bold alone). Heading hierarchy is semantic (Heading 1/2/3, not font size). Tables use Word Table Styles, not markdown. Equations via Equation Editor (OMML). Explicit page structure (section breaks, headers/footers, page numbers).

### Style Hierarchy
`Title` (one, top) · `Subtitle` · `Heading 1/2/3/4` · `Normal` / `Body Text` · `List Bullet` / `List Bullet 2` · `List Number` / `List Number 2` · `Quote`/`Block Text` · `Caption` · `Table Grid` · `Intense Quote` (callouts) · `Header`/`Footer`.

### Document Types
**Executive Report/White Paper:** Title + Subtitle → page break → H1 Executive Summary → H1 TOC (auto field) → page break → numbered H1/H2 sections with `Table Grid` tables + captions → H1 References (APA) → H1 Appendices.
**Memo:** Title "MEMORANDUM" → bold-label TO/FROM/DATE/RE → rule → H2 Purpose / Background / Recommendation (List Bullet) → sign-off.
**Investment/Deal Doc (PRT/RDC):** Title + Subtitle "Confidential | Prepared by LIFEAI | Date" → page break → H1 Executive Summary → H1 Investment Thesis (H2 Market Opportunity, H2 Regenerative Framework + Five Capitals `Table Grid`) → H1 Financial Structure (H2 Capital Stack tranche table, H2 NAV Architecture w/ Equation objects) → H1 Risk Framework (risk matrix) → H1 Governance → H1 Appendices.
**Letter (formal):** sender block → date → recipient block → `Dear [Name],` → opening (purpose) → body → closing (next steps) → `Sincerely,` → signature.

### Tables, Equations, Page Setup
Tables: `Table Grid`, bold shaded header (`#F2F2F2`), left-align text / right-align numbers, `Caption` below ("Table X: …"). Equations: specify as Equation Editor objects, e.g. `[EQUATION OBJECT: αPRT = (regen_yield − WACC_conventional) + Σ(stewardship_delta)]` with caption. Page setup: Letter/A4, 1" margins, Calibri 11 / Times 12 body, 1.15–1.5 spacing, header (title left, page# right), footer (org left, date right), numbering from page 2.

### Do NOT
❌ manual bold instead of a Style for headings · ❌ tabs/spaces for indentation · ❌ `Shift+Enter` between paragraphs (use spacing) · ❌ markdown tables · ❌ inline LaTeX · ❌ >3 heading levels without justification.

---

## § PDF Report

### Core Principles
- Final, fixed, reader-facing. Structure non-negotiable: executive summary → body → references. All sections numbered; all tables/figures captioned. Formal prose (no bullets as primary structure). Page numbers, headers, footers required.

### Structure
Cover (title, type, org+logo, date | version | confidentiality) → Executive Summary (≤1 page: what it is, 3-5 findings, recommendations) → TOC (auto, clickable) → numbered body (1 Introduction/Context · 2-4 core · 5 Conclusions) → References (APA 7th, numbered) → Appendices (A, B, C…).
Section numbering: hierarchical decimal, max 3 levels (1.1.1), never 4.

### Tables, Figures, Equations
Tables: title above (`Table X: …`), bold shaded header, `Source:` below if external, `Note:` if needed. Figures: caption below (`Figure X: …`), source, bracketed alt-text. Equations: labeled `(Equation 1)` with a `Where:` variable key.
Typography: Georgia 11 / Garamond 12 body; H1 18 bold, H2 14 bold, H3 12 bold italic; 1.5 body spacing; 1.25" binding margin; page numbers bottom-center from page 2; footer `Org | Confidential | Date`.
Confidentiality labels: `CONFIDENTIAL` · `CONFIDENTIAL — For Recipient Only` · `FOR DISCUSSION PURPOSES ONLY` · `NOT FOR DISTRIBUTION` · (none = public).

### Do NOT
❌ markdown in final content · ❌ unnumbered sections · ❌ tables without titles/sources · ❌ figures without captions · ❌ invented data (mark "Illustrative") · ❌ exec summaries over one page · ❌ incomplete citations.

---

## § Web / Landing Page

### Core Principles
- Scannable first, readable second. Above the fold is everything. One page = one conversion goal. SEO-aware without keyword stuffing. CTA appears at least twice (above fold + bottom). Mobile-first (short paragraphs/sentences).

### Page Structure
Hero (H1 value prop 6-10 words · subheadline 1-2 sentences · CTA button verb+object · optional hero media) → Social proof/trust bar → Problem (name the pain, 2-3 short paragraphs or 3 cards) → Solution (the shift; icon + headline + 1-2 sentences feature/benefit pairs) → How It Works (3-4 numbered steps, 1 sentence each) → Proof/Results (large number + short label: "340 acres restored") → CTA section (urgency headline + friction-reducer subtext + button) → Footer.

### Headlines & Body
H1 ≤8 words (benefit, not feature, active voice, power words: transform/unlock/regenerate/built/proven) · H2 ≤12 · H3 ≤6. Body: paragraphs ≤3 sentences/50 words, sentences ≤20 words, second person ("you/your"), grade 8-10 reading level.
LIFEAI/PRT examples: H1 "The Capital Stack for Regenerative Land" · H2 "How PRT Turns Stranded Assets Into Living Investments" · H3 "Place Readiness" / "Covenant-Protected Yield" / "Verified Impact".

### CTA & SEO
CTA copy: verb + specific object ("Book Your 20-Minute Call", "See the Capital Structure", "Download the Investment Brief") — never "Submit"/"Click here"/"Learn more". SEO: primary keyword in H1 + first paragraph, secondary in H2s/body naturally, meta title 50-60 chars, meta description 150-160 chars, descriptive alt text on all images.

### Do NOT
❌ paragraphs >3 sentences above the fold · ❌ passive-voice CTAs · ❌ jargon without translation · ❌ carousels/sliders above the fold · ❌ >2 CTAs per section · ❌ generic headlines ("Welcome to Our Website") · ❌ markdown in final web copy (deliver clean prose with labeled sections).

---

## Provenance

Ported into rdc-skills from the `output-channel-formatter` claude.ai skill (frontend-design-skills pack).
Originally a multi-file skill (SKILL.md + `references/*.md`); inlined into this single self-contained
SKILL.md so it works identically across the CLI plugin, the claude.ai web client (via `rdc_skill_get`),
and Codex — the rdc-skills MCP serves only SKILL.md, so all channel rules must live here.
