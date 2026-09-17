---
id: 2026-09-17-release-mcp-registry-split
date: "2026-09-17"
skill: release
session: 01a07b0d-e74e-7601-af20-9caae7e94b71
scope: architectural
status: open
area: infra
links:
  commits: [d39104709bf0035f84a8001cc6c30e5c5e0d9c13]
  memory: []
  work_items: [5f7618b4-cf32-4460-8a3a-761f0161b847]
---

## What happened

rdc-skillsv0.36.0 tag triggered npm workflow35178348993: packing succeeded,
registryPUT returned404, and npm version lookup remained404. Independently,
the existing public MCP tag updater served0.36.0 at the exacttagSHA with45skills;
connected convo retrieval and remote tests passed. Prior0.35.26 workflow also
shows a PUT404 although that version is now in npm.

## Root cause

Two release consumers advance independently: the MCP host follows mergedtags,
while npm requires a successful authenticatedpublish. A live MCP cannot prove
npm distribution, nor does failednpm publication prove the MCP is stale. The
underlying registry permission/trustedpublisher cause is not established by404.

## The fix / rule

Keep runtimeSHA/catalog and npmversion/provenance as distinct release evidence.
Preserve the failedjob; inspect publisherconfiguration with the packageowner
before changing permissions or retrying. No authboundary repair shipped here.
