#!/usr/bin/env bash
# One-time host bootstrap for the public MCP. From then on the timer keeps the
# checkout on the newest release tag (deploy/update-from-tag.sh).
#
#   cd /srv/regen/rdc-skills
#   git fetch --tags origin && git merge --ff-only v<X.Y.Z>
#   sudo ./deploy/install-systemd.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="/etc/systemd/system"
libexec_dir="/usr/local/libexec/rdc-skills"

if [[ "$repo_root" != "/srv/regen/rdc-skills" ]]; then
  echo "rdc-skills must be checked out at /srv/regen/rdc-skills" >&2
  exit 1
fi

cd "$repo_root"
# The MCP imports declared runtime dependencies (including express).  A Git
# checkout alone cannot satisfy those imports after a clean host or dependency
# cleanup, so install the committed production graph before the unit is enabled.
# No install scripts: nothing the server imports needs one, and this runs as root.
npm ci --omit=dev --no-audit --no-fund --ignore-scripts

install -m 0644 deploy/systemd/rdc-skills-mcp.service "$unit_dir/rdc-skills-mcp.service"
install -m 0644 deploy/systemd/rdc-skills-mcp-update.service "$unit_dir/rdc-skills-mcp-update.service"
install -m 0644 deploy/systemd/rdc-skills-mcp-update.timer "$unit_dir/rdc-skills-mcp-update.timer"
install -D -m 0755 deploy/update-from-tag.sh "$libexec_dir/update-from-tag.sh"
systemctl daemon-reload
systemctl enable rdc-skills-mcp.service

# `enable --now` does not restart a process that is already running, so an
# existing host would keep serving the old commit. The updater restarts into the
# checked-out release and succeeds only when /health proves it; if that release
# does not come up it returns to the commit that was serving. The timer is
# enabled either way — the updater's own state decides what the next run does —
# and the installer exits with the first run's status.
first_run=0
systemctl start rdc-skills-mcp-update.service || first_run=$?
systemctl enable --now rdc-skills-mcp-update.timer
systemctl --no-pager --full status rdc-skills-mcp.service || true
systemctl --no-pager list-timers rdc-skills-mcp-update.timer
journalctl -u rdc-skills-mcp-update.service -n 20 --no-pager || true
exit "$first_run"
