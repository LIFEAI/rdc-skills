# Infrastructure Agent Guide — Base
> Role-based context for infra/deployment/DevOps agents. Generic patterns across projects.

---

## Rule 1: NEVER Work Around Broken Infrastructure

When a service is unavailable, STOP and report BLOCKED. Do not:
- Use curl when service APIs are down
- Use workarounds or alternative approaches
- Skip verification steps
- Assume service will return to normal

**Report immediately:**

```
BLOCKED: [service name] is not responding.

Fix: [specific action for your project's infrastructure stack]

I cannot proceed until this is resolved.
```

---

## Deployment Tools

Check project overlay for:
- Primary deployment platform (Coolify, Vercel, AWS, GCP, etc.)
- MCP connectors or REST API access
- Authentication method (API token, OAuth, etc.)
- Credential location (clauth daemon, env vars, etc.)

---

## Server Infrastructure

The project specifies:
- Server IP/hostname
- Dashboard URL
- Default region/availability zones
- Server/environment IDs (UUIDs or identifiers)

---

## DNS Rules

The project specifies:
- Wildcard DNS patterns vs individual records
- Cloudflare or other DNS provider
- Proxy rules (orange cloud, DNS-only, etc.)
- SSL/TLS provisioning method

Check overlay for **critical rules** — DNS misconfigurations break deployments.

---

## Deployment Registry

The project likely has a registry/database table tracking all deployments. Before ANY deploy, verify:
```
Lookup: <slug> or <domain>
Returns: UUID, repo location, build command, build type, domain, status
```

**NEVER guess** UUIDs, domains, or build commands. Always look them up.

---

## Watch Paths

For monorepo deploys, the project specifies:
- Watch path patterns per app type
- Why watch paths matter (prevents unnecessary rebuilds)
- How to set watch paths (usually via API or config)

Without correct watch paths, every push triggers ALL apps to rebuild.

---

## Build Types

The project specifies supported build types:
- Next.js monorepo
- Vite / Node
- Static HTML
- Docker
- etc.

Check overlay for:
- Build pack (nixpacks, docker, static, etc.)
- Required environment variables
- Node version constraints
- Build command and install command

---

## Environment Tiers

The project specifies deployment environments:
- **development** -- free to experiment
- **staging** -- test before production
- **production** -- live traffic, needs confirmation

Check overlay for which tier each app is in and confirmation requirements.

---

## Deploy Checklist

Standard pattern:
1. Check git status (divergence, unpushed commits)
2. Confirm with user (especially for production)
3. Push to trigger auto-deploy (if webhook configured)
4. Verify deployment success (health check, status endpoint)
5. Check cache headers (if behind CDN)

---

## New App Deployment

The project specifies:
- DNS pattern (wildcard subdomains vs custom domains)
- Coolify/deployment platform setup
- GitHub repo connection
- Watch paths configuration
- Registry update requirement

---

## Credential Safety

- MCP connectors first (if available)
- clauth daemon second (localhost:52437)
- Never print keys to stdout
- Never hardcode credentials
- Never ask user for keys
- If daemon is down: report BLOCKED

---

## Git Workflow

The project specifies:
- Primary branch for features (develop, main, etc.)
- Force-push rules (usually: NEVER force-push main)
- Commit message format
- Auto-commit patterns

---

## Service Health Checks

The project specifies how to health-check each service:
- Ping endpoint
- Status endpoint
- Log location
- Fallback if primary method fails

---

## Troubleshooting Patterns

The project specifies common issues and fixes:
- 502/503 errors (check container logs, port mismatch)
- Disk full (clean Docker cache)
- SSL provisioning failures (check DNS config)
- Build failures (check environment variables, Node version)

---

## Specialist Context — Read Project Overlay

Your task may require reading additional project-specific guides for:
- Full deployment registry schema
- Complete DNS rules (critical for subdomains)
- Build type details
- CI/CD pipeline configuration
- Scaling and performance tuning
