# rdc:convo — attributed co-design and restart record

## Installed disposition — 2026-09-17 03:33 UTC

PR35 merged as d39104709bf0035f84a8001cc6c30e5c5e0d9c13; tagv0.36.0 pushed.
The existing public MCP tag updater now serves that exact runtime git_sha,
version0.36.0 and45skills. Connected MCP get returns convo in CLI/cloud; both
11468-character bodies compare equal to source, including all six templates.
Remote MCP suite412passed/0failed; HTTP surface40passed/0failed. Independent
validator repeated local264checks and connected catalog/health readback.

The npm publish workflow35178348993/job105064931579 failed PUT with E404;
npm0.36.0 is absent. Packing succeeded. Prior0.35.26 workflow also failed this
way despite that version being available; its publication route is not inferred.
No publishing permission change or blind rerun was attempted. Installed MCP
delivery is verified; npm distribution is NOT delivered. Independent validator
finds the task's invoked installed-skill wording satisfied through MCP, with
this distribution limitation retained explicitly. Full CDE-Zoe remains active.

The restart instructions below describe the earlier checkpoint; publication is
now a known separate failure, not a running job. Do not retag or wait on it.

Task: 5f7618b4-cf32-4460-8a3a-761f0161b847. Full CDE-Zoe goal remains active.
Repo: LIFEAI/rdc-skills; lane feat/cde-zoe-convo; base 31c8a82.
Authorized coordinator/recorder: Codex, session
01a07b0d-e74e-7601-af20-9caae7e94b71, under Dave's unattended implementation goal.
Claude participated through the existing CDE ClaudeStageDocumentRunner, native
CLI, hidden/tool-less supplied-source mode. Three actual replies, not simulated
peers. Tool process handles: 10553, 38950, 62581, all terminal exit 0.
The runner validates no exposed tools/plugins/MCP and successful text framing.
It does not prove a peer's self-reported model identity; that remains attributed.

## Checklist Decomposition Matrix

| Deliverable | Action and expected result | Evidence | Negative control |
|---|---|---|---|
| skills/convo/SKILL.md and catalog | Invoke convo; receive bounded attributed discussion contract | tests/convo.test.mjs, actual MCP sweep | malformed skill alias rejected |
| Six inline template blocks | Select each type; complete inputs/process/outputs/owner/dissent/handoff delivered in CLI/cloud | tests/convo.test.mjs plus tests/mcp.test.mjs | missing block/field fails test |
| Actual Claude/Codex exchange | Preserve amendments, dissent, decision and known limits | Final exact reply below, supplied-source boundary | no invented independent tests or assent |
| Installed invocation | Release then retrieve catalog/body matching source | Public MCP readback STILL PENDING | old/missing skill must fail |

## Checklist Quality Gate

verdict: PASS. Each declared skill/template/peer/release surface has a falsifiable
check. Catalog tests prove served content, not that every future participant obeys
instructions. The sandbox fixture checks output text; it does not prove absence
of dispatch/write calls. No new runtime, auth, scheduler or workflow transition.

## Recorder summary of rounds 1–2 (not verbatim peer text)

Codex proposed six inline templates because the existing MCP serves SKILL.md,
not sibling template resources; shared packet, neutral roles, dissent/unknown,
bounded rounds, existing transport and governed handoff. Claude agreed with that
shape and proposed packet hashes, one shared preamble, recorder boundaries,
explicit role/permission overrides and equal response budgets.

Codex rejected three proposals with reasons: requiring Dave to appoint every
recorder and approve every handoff conflicts with already authorized unattended
work; one timeout cannot establish a live peer is unavailable; unrelated collab
and co-develop repairs do not belong in this change. Claude accepted those
dispositions in round 2, while stating that Dave's full authorization text had
not been supplied to it. Claude's second review requested a way to close an
unresolved discussion with a pending live handle, neutral authorizing-principal
wording, exit labels/hash checks, explicit skill-version source and human-session
transport. Codex incorporated all five.

Round 2 packet hash:
7fd1bc18973596f7b209b9578e6f9a4dd7b5d0e1684da20dc627c4c28ef9b283.
Final exact SKILL.md packet hash:
9e21fadf29fe90bd969169cc1e9ee3e1d18c095646f7c4977b82bd2f1c68b850.
Hashes cover the exact UTF-8 SKILL.md bytes, not the surrounding review prompt.
This co-design exercised supplied-source review and hash echo, not independent
peer rehashing or the full future packet/envelope procedure it created.

## Claude final reply — verbatim

**Turn:** claude-3 · reply-to codex-3 · discussion cde-zoe-convo-20260917 · round 3 (final)
**Participant:** Claude (Opus 5, claude-opus-5), current user session
**Packet hash echo:** 9e21fadf29fe90bd969169cc1e9ee3e1d18c095646f7c4977b82bd2f1c68b850. I did not rehash it independently.
**Basis:** I reviewed only the supplied source. I read no files and ran no tests. The 264-passed/45-skills result is Codex/user-supplied, and I have not verified it.

## Stance: AGREE (adopt as-is)

I checked each of my five amendments against the text:

| Amendment | Where it landed | Position |
|---|---|---|
| Live call can close UNRESOLVED without being declared dead or re-dispatched | §6, last three sentences | AGREE |
| Authorizing principal not hardcoded | §8 "user or authorizing principal" | AGREE |
| Exit labels and hash checks | Exit check items 2 and 4 | AGREE |
| Plugin version or revision, never guessed | §3 | AGREE |
| User-session human reply is a valid transport | §4 | AGREE |

- **Doc names:** I withdraw my earlier UNKNOWN. "As applicable" matches the CDE user requirement.
- **Date:** The UTC/Denver difference is not a conflict.

## Remaining defects (none block adoption)

1. **AMEND, minor, §7 vs §9.** §7 says only the recorder writes the discussion artifact. §9 says "save durable decisions/artifacts to the authorized blackboard." It doesn't say who saves, and design outputs like DESIGN.md have separate artifact owners. Suggested wording: "the recorder saves the record; each named artifact owner saves their artifact."
2. **AMEND, minor, §8.** Delegation is scoped to reversible in-scope decisions, but irreversible or outward-facing decisions are not addressed. Suggested addition: "irreversible or external-publishing decisions require explicit confirmation from the authorizing principal."
3. **UNKNOWN, Sandbox contract.** It's unclear whether "do not mutate external state" forbids a local record write under `RDC_TEST=1`. I recommend "return inline; no artifact write" so the §7 fallback is deterministic.
4. **Minor, Exit check.** It doesn't check turn metadata (§5) or the pending handle for an UNRESOLVED-with-live-call close (§6). This is optional tightening.

## Outcome recommendation

AGREED on the packet, provided Codex accepts that defects 1–4 are non-blocking follow-ups rather than conditions. If the decision owner wants them folded in, reissue the packet with a new hash per §3. Neither peer needs another round for that.

The record destination and decision owner are still whoever the task names. Nothing in this turn grants commit or build authority.

## Codex final decision

AGREED on the exact final packet. Accept the four observations as non-blocking
limitations, not silent amendments. Existing task permissions still govern any
external action; this skill grants none. Keep the supplied-source review distinct
from test execution. No further round or CDE runtime change is needed for this
source decision. Release and installed validation remain required.

Independent Codex reviewer Dalton reported 0 critical/high/medium findings and
fresh convo 1/1 plus manifest/matrix passes. Its low finding is the sandbox
fixture's text-only negative coverage; preserve that limitation in closure.

## Restart / next action

Run all three declared proof commands after final edits, commit and push the
feature branch. Integrate reviewed source through the normal master release route,
bump package/lock/plugin versions together, tag via existing OIDC release. Read
public MCP version AND runtime git_sha; verify installed convo body exactly and
all six templates before test-review can be checked and a validator can close.
Do not claim this package is released from local tests alone.
