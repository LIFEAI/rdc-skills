#!/usr/bin/env bash
# Keep the public MCP on the newest release tag, and prove it is serving it.
#
# The tag is the promotion for rdc-skills (RELEASE.md). npm consumers get a tag
# when the registry does; this is the same act for the one consumer that runs
# from a git checkout — the public MCP at https://rdc-skills.regendevcorp.com.
# Before this existed the checkout moved only when someone logged in and pulled,
# which the fleet's hand-rolled-deploy guard refuses, so the public catalog sat
# on 0.35.18 through six releases while npm moved on.
#
# THE MODEL (classified per .claude/rules/stateful-inspection.md)
#   identity  a RELEASE: a plain vX.Y.Z tag merged into origin/master, or the
#             PROVED commit — the last one this updater restarted onto and saw
#             /health report. On a host with no history, the commit the running
#             process reports is adopted as proved: it is demonstrably serving.
#   state     HEAD; the recorded dependency and unit installs; the FAILED set;
#             the install-error ATTEMPTS against one release.
#   liveness  /health's git_sha (fixed at process start) and version (re-read
#             from package.json on every request — so only git_sha proves a
#             restart took).
#
# THE INVARIANT: the service is restarted only onto a release. HEAD is state; it
# is moved to a release, never served for being checked out. A HEAD that is not
# a release and not on origin/master (a commit made on the host) is refused and
# the service is left alone.
#
# EACH RUN: desired = the newest tag unless it has FAILED or is not ahead of the
# proved release, else the proved release. Move HEAD there if needed; if /health
# already reports it and the installs match, done. Otherwise converge (install
# what changed, restart, prove):
#   proved           record it, refresh the updater copy
#   never answers    the release is bad: record FAILED (never the proved one),
#                    return to the proved release
#   install/restart  says nothing about the release, the first two times: return
#   error            to the proved release and retry next run. The third time
#                    against the same release it is treated as bad. A registry
#                    that cannot be reached is not counted — unless it has been
#                    unreachable for that release for a whole day.
#
# Run by rdc-skills-mcp-update.timer from a copy OUTSIDE the checkout
# (/usr/local/libexec/rdc-skills), refreshed only after a proved move — a
# rollback to a release that predates this file can never delete the updater.
# State lives in /var/lib/rdc-skills-update, not in the checkout it judges.
#
# Exit codes: 0 serving the newest release · 2 wrong checkout · 3 tracked changes
# (preserved, never touched) · 4 HEAD is a commit made on the host (refused, service
# untouched) · 5 the newest release failed and the proved one is serving again ·
# 6 nothing proved serving this run (retried next run) · 7 the newest release
# failed before; the proved one is held · 8 serving and proved, but recording it
# or refreshing the updater copy failed (retried next run) · 9 the newest tag is
# not ahead of the proved release (a downgrade); the proved one is held.
#
# Everything runs from functions called on the last line. Bash reads a script as
# it executes; by the time main runs, every line it will execute has been read.
set -euo pipefail

ROOT="${RDC_SKILLS_DEPLOY_ROOT:-/srv/regen/rdc-skills}"
EXPECTED_ROOT="${RDC_SKILLS_EXPECTED_ROOT:-/srv/regen/rdc-skills}"
UNIT="rdc-skills-mcp.service"
UNIT_DIR="${RDC_SKILLS_UNIT_DIR:-/etc/systemd/system}"
LIBEXEC_DIR="${RDC_SKILLS_LIBEXEC_DIR:-/usr/local/libexec/rdc-skills}"
STATE_DIR="${RDC_SKILLS_STATE_DIR:-/var/lib/rdc-skills-update}"
LOCK_FILE="${RDC_SKILLS_LOCK_FILE:-/run/lock/rdc-skills-update.lock}"
HEALTH_URL="${RDC_SKILLS_HEALTH_URL:-http://127.0.0.1:3110/health}"
HEALTH_DEADLINE="${RDC_SKILLS_HEALTH_DEADLINE:-120}"
HEALTH_INTERVAL="${RDC_SKILLS_HEALTH_INTERVAL:-2}"
HEALTH_SETTLE_ATTEMPTS="${RDC_SKILLS_HEALTH_SETTLE_ATTEMPTS:-3}"
INSTALL_ERROR_LIMIT="${RDC_SKILLS_INSTALL_ERROR_LIMIT:-3}"
# How long one release may keep failing to reach the registry before it is judged
# bad after all (a lockfile `resolved` URL on a host that no longer exists).
NETWORK_ERROR_WINDOW="${RDC_SKILLS_NETWORK_ERROR_WINDOW:-86400}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
# Release tags are fetched with force into a namespace this updater owns, so a
# tag moved or re-created on origin updates here instead of failing the fetch.
RELEASE_REFS="refs/rdc-release-tags"

log() { printf 'rdc-skills-update: %s\n' "$*"; }

state_get() { cat "$STATE_DIR/$1" 2>/dev/null || true; }
state_put() { printf '%s\n' "$2" > "$STATE_DIR/$1.tmp" && mv -f "$STATE_DIR/$1.tmp" "$STATE_DIR/$1"; }

# Never fails, and never reads stdin: no arguments hash as empty input.
hash_files() { { if (($#)); then cat -- "$@" 2>/dev/null || true; fi; } | sha256sum | cut -d' ' -f1; }
unit_files() { (shopt -s nullglob; printf '%s\n' deploy/systemd/*.service deploy/systemd/*.timer); }

version_at() {
  git show "$1:package.json" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).version)'
}

health_field() {
  HEALTH="$1" FIELD="$2" node -e '
    try { process.stdout.write(String(JSON.parse(process.env.HEALTH)[process.env.FIELD] ?? "")); } catch {}
  ' 2>/dev/null || true
}
health_body() { curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null || true; }
answers_as() { # <body> <sha> <version>
  [[ -n "$1" && "$(health_field "$1" git_sha)" == "$2" && "$(health_field "$1" version)" == "$3" ]]
}

# The first ANSWER decides; only silence is retried — one slow response never
# restarts a healthy service. Prints the answer (empty when there was none).
settled_body() {
  local i body=""
  for ((i = 1; i <= HEALTH_SETTLE_ATTEMPTS; i++)); do
    body="$(health_body)"
    [[ -n "$body" ]] && break
    ((i < HEALTH_SETTLE_ATTEMPTS)) && sleep "$HEALTH_INTERVAL"
  done
  printf '%s' "$body"
}

wait_serving() { # <sha> <version>: after a restart, until the deadline
  local end=$((SECONDS + HEALTH_DEADLINE)) body=""
  while :; do
    body="$(health_body)"
    answers_as "$body" "$1" "$2" && return 0
    ((SECONDS >= end)) && break
    sleep "$HEALTH_INTERVAL"
  done
  log "health at $HEALTH_URL did not report $2 @ ${1:0:7} within ${HEALTH_DEADLINE}s; last: ${body:-<no answer>}"
  return 1
}

installs_match() {
  [[ -d node_modules ]] \
    && [[ "$(hash_files package-lock.json)" == "$(state_get lock-sha256)" ]] \
    && [[ "$(hash_files $(unit_files))" == "$(state_get units-sha256)" ]]
}

held() { # <sha> <version>: /health reports the release and the installs match (serve moved HEAD to it)
  answers_as "$(settled_body)" "$1" "$2" && installs_match
}

# converge <sha> <version>: with HEAD at <sha>, install what changed since the
# last install, restart, and prove it.
#   0 proved · 1 install or restart error · 2 restarted, but /health never reported it
#   3 the dependency install could not reach the registry (never counted against a release)
# Each recorded hash is cleared BEFORE its install and written after, so a run
# killed halfway is redone rather than trusted. errexit is suspended inside a
# function called from a condition, so every step checks its own status.
converge() {
  local sha="$1" version="$2" lock_hash units_hash units npm_out npm_rc
  if [[ -e git-sha.json ]]; then
    # A pack-time stamp outranks `git rev-parse` in the MCP and would pin
    # /health to whatever commit was packed here, failing every proof.
    log "removing a stale git-sha.json stamp from the checkout"
    rm -f git-sha.json || return 1
  fi
  lock_hash="$(hash_files package-lock.json)"
  if [[ ! -d node_modules || "$lock_hash" != "$(state_get lock-sha256)" ]]; then
    log "installing the locked production dependency graph"
    state_put lock-sha256 "" || return 1
    # --ignore-scripts: nothing the server imports needs an install script, and
    # this runs as root, unattended, within minutes of a tag.
    npm_rc=0
    npm_out="$(npm ci --omit=dev --no-audit --no-fund --ignore-scripts 2>&1)" || npm_rc=$?
    if ((npm_rc != 0)); then
      printf '%s\n' "$npm_out" | tail -n 5 | sed 's/^/rdc-skills-update:   /'
      # A registry that cannot be reached says nothing about the release; a
      # lockfile that cannot install does.
      if grep -qE '^npm (ERR!|error) (code (E5[0-9]{2}|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH)|network )' <<<"$npm_out"; then
        log "npm ci could not reach the registry"
        return 3
      fi
      log "npm ci failed"
      return 1
    fi
    state_put lock-sha256 "$lock_hash" || return 1
  fi
  units="$(unit_files)"
  # shellcheck disable=SC2086 # unit file names carry no spaces
  units_hash="$(hash_files $units)"
  if [[ "$units_hash" != "$(state_get units-sha256)" ]]; then
    log "installing unit files"
    state_put units-sha256 "" || return 1
    if [[ -n "$units" ]]; then
      # shellcheck disable=SC2086
      install -m 0644 $units "$UNIT_DIR/" || return 1
    fi
    "$SYSTEMCTL" daemon-reload || return 1
    state_put units-sha256 "$units_hash" || return 1
  fi
  "$SYSTEMCTL" restart "$UNIT" || { log "restart failed"; return 1; }
  wait_serving "$sha" "$version" || return 2
}

is_failed() { [[ -f "$STATE_DIR/failed" ]] && grep -qx "$1" "$STATE_DIR/failed"; }
mark_failed() { is_failed "$1" || printf '%s\n' "$1" >> "$STATE_DIR/failed"; }

# Install/restart errors counted against one release; any other release resets it.
bump_attempts() {
  local sha="$1" recorded count=0
  recorded="$(state_get attempts)"
  [[ "${recorded%% *}" == "$sha" ]] && count="${recorded##* }"
  count=$((count + 1))
  state_put attempts "$sha $count"
  printf '%s' "$count"
}

# Seconds this release has been failing to reach the registry (0 on the first failure).
network_failing_for() {
  local sha="$1" recorded now since
  now="$(date +%s)"
  recorded="$(state_get network-since)"
  if [[ "${recorded%% *}" == "$sha" ]]; then
    since="${recorded##* }"
  else
    since="$now"
    state_put network-since "$sha $now"
  fi
  printf '%s' "$((now - since))"
}

# serve <sha> <version>: move HEAD to a release and make /health prove it.
# Returns converge's code (0 also when it was already held).
serve() {
  local sha="$1" version="$2" rc=0
  if [[ "$(git rev-parse HEAD)" != "$sha" ]]; then
    git reset --quiet --hard "$sha" || return 1
  fi
  held "$sha" "$version" && return 0
  log "converging ${sha:0:7} ($version)"
  converge "$sha" "$version" || rc=$?
  return "$rc"
}

main() {
  if [[ "$ROOT" != "$EXPECTED_ROOT" ]]; then
    log "refused: checkout is $ROOT, expected $EXPECTED_ROOT"
    return 2
  fi
  mkdir -p "$STATE_DIR"
  # systemd never overlaps two timer runs; this also covers a run started by hand.
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
      log "another update run holds $LOCK_FILE"
      return 0
    fi
  fi
  cd "$ROOT"

  local tracked
  tracked="$(git status --porcelain --untracked-files=no)"
  if [[ -n "$tracked" ]]; then
    log "refused: tracked changes in $ROOT — preserved, not updated"
    printf '%s\n' "$tracked" | sed 's/^/rdc-skills-update:   /'
    return 3
  fi

  # Releases are read only from the forced namespace below, so a tag moved on
  # origin updates there instead of being refused as a clobber (which, with
  # `--tags` into refs/tags, fails the whole fetch every run). --no-tags keeps
  # refs/tags out of it entirely.
  git fetch --quiet --no-tags --prune origin \
    '+refs/heads/master:refs/remotes/origin/master' \
    "+refs/tags/v*:$RELEASE_REFS/v*"
  # Plain vX.Y.Z only: a pre-release or a stray `v*` name is never a release.
  local tag target=""
  tag="$(git for-each-ref --merged refs/remotes/origin/master --sort=-v:refname \
    --format='%(refname:lstrip=2)' "$RELEASE_REFS" \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)"
  [[ -n "$tag" ]] && target="$(git rev-parse "$RELEASE_REFS/$tag^{commit}")"

  local proved
  proved="$(state_get proved)"
  if [[ -z "$proved" ]]; then
    # No history: adopt what is demonstrably serving, so a bad first release has
    # somewhere to go back to — recorded BEFORE anything is restarted.
    local running
    running="$(health_field "$(settled_body)" git_sha)"
    # Only a commit on origin/master: adopting a host-made commit would let the
    # move below reset it off every branch.
    if [[ -n "$running" ]] && git cat-file -e "$running^{commit}" 2>/dev/null \
      && git merge-base --is-ancestor "$running" refs/remotes/origin/master; then
      state_put proved "$running"
      proved="$running"
      log "adopted the serving commit ${running:0:7} as the proved release"
    fi
  fi

  # A release only moves forward: a tag that is not the proved commit or a
  # descendant of it (a higher number put on an older commit) would downgrade the
  # public MCP. Rolling back is a new, higher tag — the tag is the promotion.
  local desired="" holding=""
  if [[ -n "$target" && -n "$proved" && "$target" != "$proved" ]] \
    && ! git merge-base --is-ancestor "$proved" "$target"; then
    desired="$proved"
    holding="behind"
  elif [[ -n "$target" ]] && ! is_failed "$target"; then
    desired="$target"
  elif [[ -n "$proved" ]]; then
    desired="$proved"
    [[ -n "$target" ]] && holding="failed"
  fi
  if [[ -z "$desired" ]]; then
    if [[ -n "$target" ]]; then
      log "$tag failed its health proof and there is no proved release to serve"
    else
      log "no release tag reachable from origin/master, and no proved release"
    fi
    return 6
  fi

  # HEAD is state, but a commit made ON the host is work that exists nowhere else:
  # never discard it, and never serve it.
  local head
  head="$(git rev-parse HEAD)"
  if [[ "$head" != "$desired" && "$head" != "$proved" && "$head" != "$target" ]] \
    && ! git merge-base --is-ancestor "$head" refs/remotes/origin/master; then
    log "refused: HEAD ${head:0:7} is a commit made on this host (not on origin/master) — preserved; the service is left as it is"
    return 4
  fi

  local version rc=0
  version="$(version_at "$desired")"
  serve "$desired" "$version" || rc=$?
  local name="${tag:-release}"
  [[ "$desired" != "$target" ]] && name="${desired:0:7}"

  if ((rc == 0)); then
    state_put attempts "" || true
    state_put network-since "" || true
    if [[ "$(state_get proved)" != "$desired" ]] && ! state_put proved "$desired"; then
      log "serving $name (${desired:0:7}), but recording it as proved failed"
      return 8
    fi
    # The updater copy follows the newest release only — a held older release may
    # predate this file. Compared by content, so a failed refresh is retried.
    if [[ "$desired" == "$target" ]] && ! cmp -s deploy/update-from-tag.sh "$LIBEXEC_DIR/update-from-tag.sh"; then
      if ! install -D -m 0755 deploy/update-from-tag.sh "$LIBEXEC_DIR/update-from-tag.sh"; then
        log "serving $name (${desired:0:7}), but refreshing the updater copy in $LIBEXEC_DIR failed"
        return 8
      fi
    fi
    if [[ "$holding" == failed ]]; then
      log "holding ${desired:0:7}: $tag (${target:0:7}) failed its health proof before; waiting for a newer tag"
      return 7
    fi
    if [[ "$holding" == behind ]]; then
      log "holding ${desired:0:7}: the newest tag $tag (${target:0:7}) is not ahead of the proved release; waiting for a newer tag"
      return 9
    fi
    log "current at $name (${desired:0:7})"
    return 0
  fi

  # Not proved. The proved release itself is never marked failed: it served.
  local bad=0
  if [[ "$desired" != "$proved" ]]; then
    if ((rc == 2)); then
      bad=1
    elif ((rc == 3)); then
      if (( $(network_failing_for "$desired") >= NETWORK_ERROR_WINDOW )); then
        log "installing $name has failed to reach the registry for over ${NETWORK_ERROR_WINDOW}s; treating it as a bad release"
        bad=1
      else
        log "the registry could not be reached installing $name; retrying next run (not counted)"
      fi
    elif (( $(bump_attempts "$desired") >= INSTALL_ERROR_LIMIT )); then
      log "install or restart error on $name for the ${INSTALL_ERROR_LIMIT}th run; treating it as a bad release"
      bad=1
    else
      log "install or restart error on $name; retrying next run"
    fi
    ((bad)) && mark_failed "$desired"
  fi

  if [[ -n "$proved" && "$desired" != "$proved" ]]; then
    log "returning to the proved release ${proved:0:7}"
    local back_rc=0
    serve "$proved" "$(version_at "$proved")" || back_rc=$?
    if ((back_rc == 0)); then
      ((bad)) && { log "$name failed; the proved release is serving again"; return 5; }
      return 6
    fi
    log "the proved release ${proved:0:7} could not be proved serving either"
  fi
  return 6
}

main "$@"; exit $?
