#!/usr/bin/env bash
# Blue-green + load-balanced deploy helper for CampusTrack. Each color
# (blue/green) is a scalable pool of backend replicas (see
# docker-compose.blue-green.yml); nginx (infra/blue-green-nginx.conf)
# routes to whichever color is active via Docker DNS, which resolves the
# service name to every currently-running replica of that color.
#
# Usage:
#   scripts/deploy-blue-green.sh init <your-domain.com>          # one-time setup
#   scripts/deploy-blue-green.sh deploy <blue|green> [replicas]  # build + scale + health/smoke test (default 3 replicas)
#   scripts/deploy-blue-green.sh flip <blue|green>               # send live traffic to that color
#   scripts/deploy-blue-green.sh rollback                        # flip back to the previous color
#   scripts/deploy-blue-green.sh status                          # show active color + per-replica health

set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.blue-green.yml"
TEMPLATE="infra/blue-green-nginx.conf"
ACTIVE_CONF="infra/nginx-active.conf"
STATE_FILE=".deploy-state"
HEALTH_CHECK_JS="require('http').get('http://localhost:5000/health', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>process.exit(JSON.parse(d).status==='ok'?0:1)) }).on('error',()=>process.exit(1))"

log() { echo "[deploy-blue-green] $*"; }
die() { echo "[deploy-blue-green] ERROR: $*" >&2; exit 1; }

current_active() {
  [ -f "$STATE_FILE" ] && cat "$STATE_FILE" || echo "none"
}

replica_ids() {
  $COMPOSE ps -q "backend-$1" 2>/dev/null
}

cmd_init() {
  local domain="${1:?Usage: $0 init <your-domain.com>}"
  [ -f "$ACTIVE_CONF" ] && die "$ACTIVE_CONF already exists — remove it first if you really want to re-init."
  sed -e "s/__ACTIVE_ENV__/blue/g" -e "s/your-domain\.com/${domain}/g" "$TEMPLATE" > "$ACTIVE_CONF"
  echo "blue" > "$STATE_FILE"
  log "Generated $ACTIVE_CONF for domain '$domain', routing to blue."
  log "Now bring the stack up, e.g.:"
  log "  $COMPOSE up -d --build --scale backend-blue=3 --scale backend-green=0 \\"
  log "    postgres redis piston1 piston2 piston3 piston-lb backend-init backend-blue backend-green frontend-dist nginx"
  log "Blue is what nginx will route to. Deploy your first real version to blue with: $0 deploy blue"
}

# Waits until every currently-running replica of backend-<env> reports
# healthy. Requires at least one replica to exist.
wait_healthy() {
  local env="$1" retries=30
  log "Waiting for backend-${env} replicas to report healthy..."
  for i in $(seq 1 "$retries"); do
    local ids; ids=$(replica_ids "$env")
    if [ -n "$ids" ]; then
      local all_healthy=1
      for id in $ids; do
        local status; status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo "none")
        [ "$status" = "healthy" ] || all_healthy=0
      done
      if [ "$all_healthy" = "1" ]; then
        log "backend-${env}: $(echo "$ids" | wc -l | tr -d ' ') replica(s) healthy."
        return 0
      fi
    fi
    sleep 5
  done
  die "backend-${env} did not become healthy after $((retries * 5))s"
}

# Hits GET /health inside every replica of backend-<env> over the internal
# network (there's no published host port once a color is scaled past 1).
smoke_test() {
  local env="$1"
  local ids; ids=$(replica_ids "$env")
  [ -n "$ids" ] || die "No running replicas for backend-${env} to smoke test."
  log "Smoke testing backend-${env} ($(echo "$ids" | wc -l | tr -d ' ') replica(s))..."
  for id in $ids; do
    docker exec "$id" node -e "$HEALTH_CHECK_JS" \
      || die "GET /health failed inside container $id (backend-${env})"
  done
  log "  /health OK on all backend-${env} replicas"
  # Login smoke test is deliberately not run here by default: it needs a
  # real seeded account and would itself count against authLimiter. Verify
  # manually against nginx once flipped, e.g.:
  #   curl -sf -X POST https://your-domain.com/api/auth/login \
  #     -H "Content-Type: application/json" \
  #     -d '{"email":"you@yourcollege.edu","password":"..."}'
}

cmd_deploy() {
  local env="${1:?Usage: $0 deploy <blue|green> [replicas]}"
  local replicas="${2:-3}"
  [ "$env" = "blue" ] || [ "$env" = "green" ] || die "env must be 'blue' or 'green'"
  log "Building and scaling backend-${env} to ${replicas} replica(s)..."
  $COMPOSE up -d --build --scale "backend-${env}=${replicas}" "backend-${env}"
  wait_healthy "$env"
  smoke_test "$env"
  log "backend-${env} deployed and passing smoke tests. It is NOT yet receiving live traffic — run '$0 flip ${env}' when ready."
}

cmd_flip() {
  local target="${1:?Usage: $0 flip <blue|green>}"
  [ "$target" = "blue" ] || [ "$target" = "green" ] || die "target must be 'blue' or 'green'"
  [ -f "$ACTIVE_CONF" ] || die "$ACTIVE_CONF not found — run '$0 init <domain>' first."

  smoke_test "$target"

  local previous; previous=$(current_active)
  sed -i.bak -E "s/backend-(blue|green)/backend-${target}/g" "$ACTIVE_CONF"
  rm -f "${ACTIVE_CONF}.bak"

  $COMPOSE exec nginx nginx -t
  $COMPOSE exec nginx nginx -s reload

  [ "$previous" != "none" ] && [ "$previous" != "$target" ] && echo "$previous" > "${STATE_FILE}.previous"
  echo "$target" > "$STATE_FILE"
  log "Traffic flipped to ${target} (was: ${previous})."
}

cmd_rollback() {
  [ -f "${STATE_FILE}.previous" ] || die "No previous state recorded — nothing to roll back to."
  local target; target=$(cat "${STATE_FILE}.previous")
  log "Rolling back to ${target}..."
  cmd_flip "$target"
}

cmd_status() {
  log "Active environment: $(current_active)"
  for env in blue green; do
    local ids; ids=$(replica_ids "$env")
    if [ -z "$ids" ]; then
      echo "  backend-${env}: no replicas running"
      continue
    fi
    local healthy=0 total=0
    for id in $ids; do
      total=$((total + 1))
      status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo "none")
      [ "$status" = "healthy" ] && healthy=$((healthy + 1))
    done
    echo "  backend-${env}: ${healthy}/${total} replica(s) healthy"
  done
}

case "${1:-}" in
  init)     shift; cmd_init "$@" ;;
  deploy)   shift; cmd_deploy "$@" ;;
  flip)     shift; cmd_flip "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  status)   cmd_status ;;
  *) die "Usage: $0 {init|deploy|flip|rollback|status} ..." ;;
esac
