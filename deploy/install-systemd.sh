#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_source="$repo_root/deploy/systemd/rdc-skills-mcp.service"
unit_target="/etc/systemd/system/rdc-skills-mcp.service"

if [[ "$repo_root" != "/srv/regen/rdc-skills" ]]; then
  echo "rdc-skills must be checked out at /srv/regen/rdc-skills" >&2
  exit 1
fi

install -m 0644 "$unit_source" "$unit_target"
systemctl daemon-reload
systemctl enable --now rdc-skills-mcp.service
systemctl --no-pager --full status rdc-skills-mcp.service
