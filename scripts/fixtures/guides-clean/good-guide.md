# Good Infrastructure Guide — FIXTURE (clean, no banned terms)
> This file is used by the rdc:self-test guide-content validator fixture test.
> It is a clean guide with no banned terms.

## Coolify Access

There is no Coolify MCP server. Do not reference `@masonator/coolify-mcp`.
Never use brand-studio — the canonical name is Studio.
The @regen/brand-studio package does not exist — use @regen/studio.

All Coolify operations use the clauth daemon + REST API:

```bash
_COOLIFY=$(curl -s http://127.0.0.1:52437/v/coolify-api)
curl -s -H "Authorization: Bearer $_COOLIFY" https://deploy.regendevcorp.com/api/v1/applications
```
