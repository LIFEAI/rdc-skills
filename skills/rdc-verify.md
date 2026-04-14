---
name: rdc:verify
description: Verification gate — no completion claims without fresh evidence. Run at end of build, or invoke from review.
---

# rdc:verify — Verification Before Completion

> Adapted from obra/superpowers `verification-before-completion`.
> Stack-specific: uses `npx vitest run` + `npx tsc --noEmit`. NEVER `pnpm build` (crashes machine — 800MB/process).

## The Iron Law

**NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.**

You may not say "done", "complete", "working", "fixed", "passing", or imply success until you have:

1. **Identified** the exact commands that prove the claim
2. **Run** those commands fresh in the current state (not memory, not "earlier", not "should")
3. **Read** the full output
4. **Verified** the output matches the claim
5. Only THEN made the claim, quoting the evidence

If you cannot run the commands, say so explicitly. Do not substitute reasoning for evidence.

## Red Flags — Stop and Verify

If you're about to write any of these, STOP:

- "should work" / "should pass" / "should be fine"
- "probably" / "seems to" / "looks good"
- "I think the tests pass"
- "the types check out" (without running tsc)
- "everything compiles" (without fresh output)
- Expressing satisfaction or wrapping up before the gate ran

## The Gate — Commands for This Stack

Run these in order. All must pass. Capture output.

### 1. Per-package vitest (every package touched)

```bash
cd <repo-root>
for pkg in <changed-packages>; do
  npx vitest run --dir packages/$pkg 2>&1 | tee /tmp/verify-$pkg.log
done
```

Or for a single package:
```bash
npx vitest run --dir packages/<pkg>
npx vitest run --dir apps/<app>
```

**NEVER** run `pnpm build` or `pnpm test` at the repo root — spawns 5-7 node processes at 800MB each and crashes the machine.

### 2. Typecheck per package

```bash
npx tsc --noEmit --project packages/<pkg>/tsconfig.json
npx tsc --noEmit --project apps/<app>/tsconfig.json
```

One package at a time. Read the full output — zero errors required.

### 3. Lint (if configured for the package)

```bash
npx eslint <paths> --max-warnings=0
```

### 4. Smoke check exports (if package adds public API)

```bash
node -e "const m = require('<pkg>'); console.log(Object.keys(m));"
```

Or for ESM:
```bash
node --input-type=module -e "import * as m from '<pkg>'; console.log(Object.keys(m));"
```

## Rationalization Prevention

| You're tempted to think... | Reality |
|---|---|
| "Tests passed earlier, should still pass" | Run them now. Code changed. |
| "TypeScript is strict, if it built it works" | You didn't build. Run tsc. |
| "Small change, no need to retest" | Small changes are where regressions hide. |
| "I'll note it as pending verification" | No. Verify now or mark incomplete. |
| "The test file looks right" | Reading ≠ running. Run it. |

## Output Format — Required

When reporting completion, use this structure:

```
## Verification Evidence

### vitest
$ npx vitest run --dir packages/hail
 Test Files  12 passed (12)
      Tests  147 passed (147)

### tsc
$ npx tsc --noEmit --project packages/hail/tsconfig.json
(no output — clean)

### Status
PASS — safe to mark tasks done.
```

If any step fails: do NOT claim completion. Report the failure, fix it, re-run the entire gate.

## When to Invoke

- **End of `/rdc:build`** — mandatory final phase before marking epic done
- **During `/rdc:review`** — verification gate after fixes applied
- **Before any "done" declaration** — if an agent or supervisor is about to say work is complete
- **After merging waves** — when parallel agents finish and their work is combined

## Agent Delegation

When dispatching a verification agent, give them:
- Exact list of packages/apps to verify
- Explicit ban on `pnpm build` / `pnpm test` / `pnpm -r`
- Required output format (above)
- Instruction: "If any command fails, STOP and report. Do not fix. Do not continue."

## The Bottom Line

Evidence before claims. Fresh evidence, not remembered evidence. Full output, not selective reading. If you skip the gate, you are lying about the work being done.
