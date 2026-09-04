---
name: deploy
description: rdc:deploy (slug, [action]) — run one command; exit 0 means shipped
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> One command, then one line: the URL on exit 0, or the `DEPLOY-FAILED` block on
> non-zero. No tool-call narration, no raw JSON dumps, no progress commentary.

# rdc:deploy — run the program, read the exit code

**This skill is not a procedure. It is one command.**

```
rdc:deploy <slug>            →  node scripts/deploy/deploy.mjs <slug>
rdc:deploy <slug> promote    →  node scripts/deploy/deploy.mjs <slug> promote
```

Run it from the regen-root checkout you are working in. That is the whole
instruction. There is no checklist to follow, no mode to pick, and no decision
for you to make on the success path.

## Exit 0 — you are done

Print the URL the program reports, and stop.

Do not verify it again, do not audit anything, do not "while I'm here". The
program already resolved the slug from the registry, submitted the build and the
ship, polled the job to a terminal phase, health-probed the deployed URL and
wrote a receipt under `.rdc/evidence/deploys/`. If any of those had failed, the
exit code would not have been 0.

## Exit non-zero — and ONLY then, diagnose

Every non-zero exit prints a `DEPLOY-FAILED` block naming four things — **which
step, which command, which exit code, and what the tool actually said** —
followed by the same record as one line of JSON.

| exit | meaning | first move |
|---|---|---|
| 2 | usage — bad or missing arguments | read the usage line; this program takes a slug and optionally `promote` |
| 3 | deploy manager unreachable | `pm2 restart regen-deploy-mgr` (it is a local PM2 process), then re-run |
| 4 | slug not resolvable or not routable | the block names what is missing — a registry row, or an allowlist entry |
| 5 | a submitted job failed or was rejected | the block carries the manager's own step, command, exit code and stderr tail |
| 6 | the job succeeded but the health probe did not | bytes shipped, app did not come up — read the job the block names |
| 7 | polling exceeded the deadline | the job is NOT cancelled; the block gives the URL to read it |

**Fix the script, never the symptom.** When the deploy is wrong, the repair
belongs in `scripts/deploy/deploy.mjs` or in the deploy manager it calls. A
one-off workaround leaves the next agent to rediscover the same failure, which
is the exact history this command replaced.

## Hand-rolling a deploy is guard-blocked

Over a remote shell, these are refused at the tool layer by the
`hand-rolled-deploy` rule (both engines):

- `pm2 restart|reload|start|stop|delete` aimed at an application
- an application build (`next build`, `pnpm build`, `turbo run build`, …)
- `git pull` on a deploy target

Direct Coolify deploy triggers are refused by `coolify-direct`.

Not blocked, because they are how you diagnose the failure above: remote `pm2
list` / `pm2 logs` / `pm2 describe`, `docker ps`, anything local, and PM2
lifecycle operations on infrastructure daemons (codeflow-mcp, fs-mcp, rtp,
regen-deploy-mgr, pollers).

Genuine host-level recovery goes through `flow=sv-override`. Reaching for it to
avoid a failing deploy is not recovery.

## What this command deliberately does NOT do

`deploy` and `promote` are the only two actions. The program refuses anything
else by name rather than guessing.

The previous version of this file carried seven modes — `new`, `diagnose`,
`audit`, `convert`, `maintenance` alongside deploy and promote — across 566
lines of checklists and prose. Every one of them was an instruction an agent had
to read and interpret, and interpretation is why deployments broke differently
each time. **Those modes are not implemented here and are not silently available
elsewhere** — that is a real reduction in what this skill offers, recorded rather
than glossed:

| dropped mode | where the capability stands now |
|---|---|
| `new <slug>` | not automated — register the app in `app_deployments` first; this program ships registered apps, it does not create them |
| `diagnose <slug>` | the failure block plus the manager's job record (`GET :52438/v1/local/jobs/<id>`) and its two-box dashboard |
| `audit` | the manager's dashboard (`GET :52438/v1/local/dashboard?box=local\|vultr`) — PM2 state joined against the registry, with URL health |
| `convert` | an architectural change; goes through `.claude/rules/architectural-change-approval.md` |
| `maintenance <service>` | private Coolify infrastructure; unchanged and not part of this command |

The removed prose also carried real, hard-won operational knowledge — the
`next start` `BUILD_ID` crash-loop, the `media.place.fund` hotlink referer
allowlist, the `<head>` metadata audit, the lockfile-importer trap on a first
promote to `main`. That knowledge is in git history for this file and in the
named `.rdc/lessons/` entries it cited. **It was removed from here because prose
that duplicates behaviour drifts from it** — not because it stopped being true.
Where such a check belongs in the pipeline, it belongs in the program or in the
manager, where it runs, rather than in a document that hopes to be read.

## Authorization

A dev deploy needs no approval. `promote` puts bytes on production and needs
explicit go-ahead for that call. The program itself refuses to promote anything
that is not an image-model app, because promote retags the digest dev already
runs — **a promote never builds**, and one that fell back to building would ship
bytes production has never seen under a name claiming it had.

## Verification

`node scripts/deploy/__tests__/deploy.test.mjs` (node --test) covers the exit
contract; `scripts/deploy/atf.ladder.mjs` holds golden-capture records of every
enumerated failure; `scripts/deploy/atf.probe.mjs` is the live probe against the
running manager. Full climb: `node C:/Dev/atf/bin/ladder-run.mjs scripts/deploy`.
