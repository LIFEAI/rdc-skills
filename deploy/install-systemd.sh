#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_source="$repo_root/deploy/systemd/rdc-skills-mcp.service"
unit_target="/etc/systemd/system/rdc-skills-mcp.service"

if [[ "$repo_root" != "/srv/regen/rdc-skills" ]]; then
  echo "rdc-skills must be checked out at /srv/regen/rdc-skills" >&2
  exit 1
fi

cd "$repo_root"
# The MCP imports declared runtime dependencies (including express).  A Git
# checkout alone cannot satisfy those imports after a clean host or dependency
# cleanup, so install the committed production graph before the unit is enabled.
npm ci --omit=dev --no-audit --no-fund

install -m 0644 "$unit_source" "$unit_target"
systemctl daemon-reload
systemctl enable --now rdc-skills-mcp.service
systemctl --no-pager --full status rdc-skills-mcp.service
