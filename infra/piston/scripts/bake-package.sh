#!/usr/bin/env bash
# Installs ONE language package into /piston/packages during `docker build`
# (see ../Dockerfile, which runs this once per language in its own build
# stage so BuildKit can download/install them all in parallel instead of
# one long serial RUN).
#
# Starts the Piston API directly (`node /piston_api/src`) rather than going
# through the image's normal docker-entrypoint.sh, because that entrypoint
# sets up cgroup v2 + isolate for sandboxing job *execution* — privileged
# host access a `docker build` sandbox doesn't have and doesn't need here.
# Installing a package is just: download a tarball, checksum it, and
# `tar xzf` it (see upstream api/src/package.js) — no sandboxing involved,
# so the plain API process is enough.
#
# Usage: bake-package.sh <language> <version>
set -euo pipefail

lang="$1"
ver="$2"

SERVER_PID=""

start_server() {
  node /piston_api/src &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
}

# Blocks until the API answers, or exits the build with a clear error if it
# never comes up within the window.
wait_for_api() {
  echo "[$lang] Waiting for Piston API..."
  for i in $(seq 1 60); do
    if node -e "require('http').get('http://localhost:2000/api/v2/runtimes', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"; then
      return 0
    fi
    if [ "$i" = 60 ]; then
      echo "[$lang] Piston API never came up during build" >&2
      exit 1
    fi
    sleep 1
  done
}

# Confirms the server process AND the API are actually alive, restarting the
# process first if it died. Seen in practice: the server can crash partway
# through a heavy install (e.g. under memory pressure while building on a
# host also running other things) — retrying the install POST against a
# server that's no longer there just fails instantly with ECONNREFUSED,
# burning through every retry attempt in under a second with no real retry
# ever happening. Call this before every attempt, not just once up front.
ensure_server_up() {
  if [ -z "$SERVER_PID" ] || ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[$lang] Piston API process is not running — (re)starting it"
    start_server
  fi
  wait_for_api
}

# The install itself (package.js's fetch() of the runtime tarball, server-side
# inside the piston API process) has no timeout of its own, and neither did
# this script previously — on a slow/flaky connection a stalled download just
# hung the RUN step forever, with no way out but killing `docker build`
# manually. `timeout` bounds each attempt; the retry loop absorbs the kind of
# transient stall/reset that usually succeeds on a second try.
attempt=1
max_attempts=3
timeout_secs=300  # generous — java/gcc tarballs are the largest, plan for a slow link
while true; do
  ensure_server_up

  echo "[$lang] installing ${lang}=${ver} (attempt ${attempt}/${max_attempts}, ${timeout_secs}s timeout)"
  if timeout "${timeout_secs}s" node -e "
    const http = require('http');
    const data = JSON.stringify({ language: process.argv[1], version: process.argv[2] });
    const req = http.request({
      hostname: 'localhost', port: 2000, path: '/api/v2/packages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) { console.log('[' + process.argv[1] + '] OK'); process.exit(0); }
        console.error('[' + process.argv[1] + '] FAILED', res.statusCode, body); process.exit(1);
      });
    });
    req.on('error', e => { console.error(e); process.exit(1); });
    req.write(data);
    req.end();
  " "$lang" "$ver"; then
    break
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[$lang] install failed after ${max_attempts} attempts (last one either errored, timed out after ${timeout_secs}s, or the server process died)" >&2
    exit 1
  fi
  echo "[$lang] attempt ${attempt} failed — retrying..." >&2
  attempt=$((attempt + 1))
  sleep 5
done
