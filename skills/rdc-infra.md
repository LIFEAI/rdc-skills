---
name: rdc:infra
description: >-
  Dispatch an infrastructure agent for deployments, DNS configuration,
  SSL, environment variables, build config, and CI/CD operations.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md`).


# rdc:infra — Infrastructure Agent

## Mandatory First Step

Read the guide before ANY operations:
```
{PROJECT_ROOT}/.rdc/guides/infrastructure.md
(fallback: {PROJECT_ROOT}/docs/guides/infrastructure.md)
```

## Rule 1: Never Work Around Broken Infrastructure

When a service is unavailable, STOP and report:
```
BLOCKED: [service] is not responding.
Fix: [reconnect MCP / restart credential daemon]
I cannot proceed until this is resolved.
```

## Deployment Registry — Check BEFORE Any Deploy

```sql
SELECT get_deployment('<slug>');
SELECT slug, display_name, domain, build_type, status FROM deployment_registry ORDER BY slug;
```

**NEVER guess deployment UUIDs, domains, or build commands.**

## Watch Paths — Must Set on Every Monorepo App

| App Type | Watch Paths |
|----------|-------------|
| Monorepo app | `apps/<n>/**` and `packages/**` |
| Static monorepo | `sites/<n>/**` |

Without watch_paths, every push rebuilds all apps.

## Build Types

| Type | Pack | Install | Build |
|------|------|---------|-------|
| Monorepo | nixpacks | `pnpm install --frozen-lockfile` | `pnpm turbo run build --filter=<filter>` |
| Static | static | — | — |

## New App — Checklist

1. Look up deployment registry for existing entry
2. Check for Coolify UUID (if exists)
3. Set watch_paths per app type
4. Deploy and verify health
5. Update deployment_registry in database

## Environment Tiers

| Tier | Rules |
|------|-------|
| development | Free to experiment, no confirmation needed |
| staging | Confirm before deploying |
| production | ALWAYS confirm before deploy, ALWAYS verify after |

## Git Workflow

- Branch: development branch — NEVER touch production
- Before push: `git fetch origin`
- Never force-push

## Safety Rules

- MCP connectors first, credential daemon second
- Never print credential keys to stdout
- If daemon is down: report BLOCKED, do not work around it
- Push after every logical block
