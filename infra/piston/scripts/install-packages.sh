#!/usr/bin/env bash
# Installs the language runtimes CampusTrack needs, via Piston's HTTP API
# (POST /api/v2/packages) — the official Piston image has NO `piston` CLI
# binary inside it, so this must go through the API, not `docker exec`.
#
# Packages install onto the shared `piston_packages` volume, so installing
# once (against any single replica, or through piston-lb) makes them
# available to all three piston1/piston2/piston3 replicas — you do not need
# to repeat this per-container.
#
# Usage:
#   ./infra/piston/scripts/install-packages.sh
#   ./infra/piston/scripts/install-packages.sh http://localhost:2000   # custom base URL

set -euo pipefail

BASE_URL="${1:-http://localhost:2000}"

PACKAGES=(
  "python 3.10.0"
  "node 18.15.0"       # backs the "javascript" language
  "java 15.0.2"
  "gcc 10.2.0"         # backs both "c" and "c++" (cpp)
  "sqlite3 3.36.0"     # backs the "sql" language
)

echo "Installing ${#PACKAGES[@]} Piston language packages via ${BASE_URL}..."
echo "(requires the host running docker compose to have internet access —"
echo " packages are pulled from the official Piston package repository)"
echo

for pkg in "${PACKAGES[@]}"; do
  set -- $pkg
  lang="$1"; ver="$2"
  echo "==> installing ${lang}=${ver}"

  attempt=1
  max_attempts=3
  while true; do
    http_code=$(curl -s -o /tmp/piston-install-response.json -w "%{http_code}" \
      -X POST "${BASE_URL}/api/v2/packages" \
      -H "Content-Type: application/json" \
      -d "{\"language\":\"${lang}\",\"version\":\"${ver}\"}")

    if [ "$http_code" == "200" ]; then
      echo "    OK"
      break
    elif grep -q "Already installed" /tmp/piston-install-response.json 2>/dev/null; then
      echo "    OK (already installed)"
      break
    elif [ "$attempt" -lt "$max_attempts" ]; then
      # Downloads happen server-side from GitHub's release CDN — a
      # timeout/connection error there is usually transient, so retry
      # before giving up.
      echo "    attempt ${attempt}/${max_attempts} failed (HTTP ${http_code}), retrying..."
      attempt=$((attempt + 1))
      sleep 3
    else
      echo "    FAILED after ${max_attempts} attempts (HTTP ${http_code}):"
      cat /tmp/piston-install-response.json
      echo
      break
    fi
  done
done

echo
echo "Restarting piston1/piston2/piston3 so every replica re-scans the shared"
echo "package volume and picks up everything just installed. (Piston only"
echo "registers a newly-installed package into the in-memory runtime list of"
echo "whichever replica happened to handle that specific install request —"
echo "sibling replicas only pick it up on their own next startup.)"
docker restart pp_piston1 pp_piston2 pp_piston3 >/dev/null
echo "Waiting for replicas to become healthy again..."
for c in pp_piston1 pp_piston2 pp_piston3; do
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = "healthy" ]; do
    sleep 1
  done
done

echo
echo "Done. Verifying installed runtimes on each replica directly (bypassing"
echo "the load balancer, so we're not just sampling one of the three):"
for c in pp_piston1 pp_piston2 pp_piston3; do
  echo "--- ${c} ---"
  docker exec "$c" node -e "
    require('http').get('http://localhost:2000/api/v2/runtimes', r => {
      let d=''; r.on('data', c => d += c);
      r.on('end', () => {
        const langs = JSON.parse(d).map(x => x.language + '-' + x.version).sort();
        console.log(langs.length + ' runtimes: ' + langs.join(', '));
      });
    });
  "
done
