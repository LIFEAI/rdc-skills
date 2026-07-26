#!/usr/bin/env bash
# Install rdc-skills globally FROM LOCAL SOURCE, using the stop-first sequence.
#
# This is the empirical test of the fix: the same `npm install -g` that produced
# EBUSY should now succeed because the lock holder is stopped first. It is a LOCAL
# install (a path, not the registry) — nothing is published.
#
# The restart is unconditional: leaving the MCP down after a failed install would
# be worse than the failure being repaired.
set -u

HOLDER=rdc-skills-mcp

echo "== before =="
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);console.log('  '+process.argv[1]+': '+(p?p.pm2_env.status:'absent'));})" "$HOLDER"
npm ls -g '@lifeaitools/rdc-skills' --depth=0 2>/dev/null | tail -1

echo "== stop the lock holder =="
pm2 stop "$HOLDER" >/dev/null 2>&1 && echo "  stopped $HOLDER" || echo "  could not stop (may be absent)"

echo "== npm install -g from local source =="
set +e
npm install -g "C:/Dev/rdc-skills" 2>&1 | tail -5
INSTALL_RC=${PIPESTATUS[0]}
set -e
echo "  install exit=$INSTALL_RC"

echo "== restart (always) =="
pm2 restart "$HOLDER" >/dev/null 2>&1 && echo "  restarted $HOLDER" || echo "  restart FAILED"

echo "== after =="
npm ls -g '@lifeaitools/rdc-skills' --depth=0 2>/dev/null | tail -1
for i in 1 2 3 4 5 6 7 8; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3110/health 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "  health 3110 -> HTTP ${code:-none}"
curl -s --max-time 3 http://127.0.0.1:3110/health 2>/dev/null | head -c 200
echo
exit "$INSTALL_RC"
