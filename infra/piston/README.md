# Piston (code execution engine)

> **Note:** the root `docker-compose.yml` currently runs a single Piston
> instance built from [`Dockerfile`](Dockerfile), with language packages
> baked in at image build time via [`scripts/bake-package.sh`](scripts/bake-package.sh)
> (one language per parallel build stage) — no install step needed after
> `docker compose up`. The three-replica +
> nginx load-balancer topology and `install-packages.sh` documented below
> describe a heavier setup for higher-throughput deployments; they're not
> what the root compose file wires up today.

CampusTrack uses [Piston](https://github.com/engineer-man/piston) — the same
open-source, self-hosted execution engine used by EMKC — to compile and run
student code for "Run Code" and coding-test grading. It replaces the
previous custom `infra/codebox` engine.

## Topology

```
backend (pp_backend)
   │  PISTON_API_URL=http://piston-lb:2000/api/v2
   ▼
piston-lb (nginx, least_conn)
   │
   ├── piston1 (ghcr.io/engineer-man/piston, privileged)
   ├── piston2 (ghcr.io/engineer-man/piston, privileged)
   └── piston3 (ghcr.io/engineer-man/piston, privileged)
          │
          └── shared `piston_packages` volume (installed runtimes)
```

* `piston-lb` — nginx, load-balances across the three replicas with
  `least_conn` so a slow Java compile on one replica doesn't back up
  requests routed to the other two. Config: [`lb/nginx.conf`](lb/nginx.conf).
* `piston1` / `piston2` / `piston3` — three replicas of the official Piston
  image. Each runs `privileged` (Piston needs this to sandbox untrusted code
  via nsjail/isolate) and shares one `piston_packages` volume, so language
  runtimes only need to be installed once.
* Each replica is configured with `PISTON_MAX_CONCURRENT_JOBS=80`, so the
  pool as a whole can have ~240 executions in flight at once — comfortable
  headroom above the ~200 simultaneous users this platform is sized for
  (not every student is submitting code in the exact same second, and each
  execution only holds a slot for the run/compile duration, typically well
  under a second to a few seconds).

## First-time setup: installing language packages

Piston ships with **no languages installed by default** — you install only
what you need. After bringing the stack up for the first time:

```bash
docker compose up -d piston1 piston2 piston3 piston-lb
./infra/piston/scripts/install-packages.sh
```

This installs the exact versions `backend/src/services/piston.js` expects
(python 3.10.0, node 18.15.0 for JavaScript, java 15.0.2, gcc 10.2.0 for C
and C++, sqlite3 3.36.0 for SQL) onto the shared volume — all three replicas
immediately see them.
**This step needs outbound internet access** on the Docker host, since
`POST /api/v2/packages` pulls prebuilt runtime tarballs from Piston's package
repository.

If you add a language, add it in two places: the `PACKAGES` array in
`scripts/install-packages.sh`, and `LANGUAGE_MAP` in
`backend/src/services/piston.js`.

Note: the official Piston image has no `piston` CLI binary inside it —
package installs go through the HTTP API (`POST /api/v2/packages`), which is
what `install-packages.sh` does. Don't try `docker exec ... piston ...`.

### Important: installs land on ONE replica's memory, not all three

`install-packages.sh` sends each install request through `piston-lb`, which
load-balances it to *one* of piston1/2/3. That replica downloads the package
onto the shared `piston_packages` volume (so the files are now visible to
all three) — but each Piston process only loads newly-installed runtimes
into its own in-memory list; it does **not** notice packages a sibling
replica just installed onto the shared volume. Only a fresh container start
re-scans the volume from disk.

In practice this means after running installs, your languages end up
scattered unevenly across piston1/2/3's in-memory awareness — one replica
might "know" about most of them, another about a few, a third about none —
even though all of them are physically on disk. Since `piston-lb`
load-balances every request (installs *and* executions) across the three,
this silently causes some fraction of "Run Code" submissions to fail with
"runtime is unknown" depending on which replica they land on.

`install-packages.sh` handles this automatically: after all installs finish,
it restarts piston1/2/3 so every replica re-scans the shared volume and ends
up with the same full runtime list, then verifies each replica directly
(bypassing the load balancer) to confirm they're in sync. If you ever
install a package manually outside this script, restart all three replicas
afterward the same way:

```bash
docker restart pp_piston1 pp_piston2 pp_piston3
```

## Verifying it's working

```bash
curl http://localhost:2000/api/v2/runtimes   # via piston-lb — lists installed languages
```

The backend also exposes `GET /api/code/status` (see `codeOps.js`), which
the frontend uses to show a banner if the execution service is unreachable.

## Why not codebox?

`infra/codebox` was a bespoke Judge0-style engine (custom Docker-per-run
executor + Redis queue). Piston is a maintained, widely-used, purpose-built
sandboxing engine, so the platform now uses it directly instead of
maintaining a parallel in-house one. One functional difference worth
knowing: Piston's REST API doesn't report CPU time/peak memory the way
Judge0/codebox did, so `time` shown in the UI is wall-clock round-trip time
(not exact CPU time) and `memory` is not reported.
