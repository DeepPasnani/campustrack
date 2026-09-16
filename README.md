<div align="center">

# CampusTrack

**A full-stack placement-preparation & mock-assessment platform for college T&P cells.**

Build multi-section aptitude + coding tests, invite students in bulk, watch submissions come in live, and get auto-graded results with percentile analytics — all from one dashboard.

</div>

---

## Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Option A: Docker Compose (recommended)](#option-a-docker-compose-recommended)
  - [Option B: Manual / local dev](#option-b-manual--local-dev)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Image Uploads](#image-uploads)
- [Supported Coding Languages](#supported-coding-languages)
- [Observability](#observability)
- [Deploying to Production](#deploying-to-production)
- [Backing Up & Restoring Data](#backing-up--restoring-data)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **Test Builder** — three-step wizard for multi-section tests mixing MCQ (aptitude) and coding sections, each with its own timer, difficulty mix, and pass criteria.
- **Question Bank** — build a reusable library of questions once and pull them into any future test.
- **Live Code Execution** — full Monaco editor with grading against hidden test cases via a self-hosted [Piston](https://github.com/engineer-man/piston) instance; supports Python, JavaScript, Java, C, C++, and SQL (see [Supported Coding Languages](#supported-coding-languages)).
- **Real-Time Proctoring** — WebSocket heartbeat monitoring, tab-switch detection, fullscreen enforcement, keystroke/plagiarism signals, and automatic submission on expiry.
- **Results & Analytics** — score distributions, percentile rankings, per-question breakdowns, and CSV/PDF export with AI-powered insights.
- **Leaderboard & Gamification** — students are ranked across their cohort by performance, with XP points, badges, and achievement tracking.
- **Plagiarism Detection** — advanced code similarity analysis with detailed comparison views.
- **AI Features** — AI-powered question generation, natural language analytics queries, automated tagging, and student feedback.
- **Multi-admin support** — every admin account sees and can manage the full shared pool of tests, classes, and question banks (not just their own).
- **Google OAuth login** for students, email/password for staff, with optional 2FA support.
- **Placement Drives** — organize campus recruitment drives with multiple test rounds.
- **Resources & Forum** — share learning materials and enable student discussion forums.
- **Built-in observability** — Prometheus metrics, structured JSON logging shipped to Loki, and Grafana dashboards, wired up out of the box (see [Observability](#observability)).

> A number of integration points are scaffolded in `.env.example` and/or the database schema (SSO/SAML/LDAP, LMS sync, ATS, Zoom, Stripe/Razorpay, Twilio) but have **no backend implementation wired up yet** — setting those env vars currently has no effect. Treat them as reserved for future work, not working features.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, TanStack Query, Zustand, Tailwind CSS, Monaco Editor |
| Backend | Node.js, Express, PostgreSQL (`pg`), Redis, JWT auth, Helmet, Pino |
| Code execution | [Piston](https://github.com/engineer-man/piston), self-hosted with language runtimes baked into a custom image (`infra/piston/Dockerfile`) |
| Edge / TLS | [Caddy](https://caddyserver.com/) (`lucaslorentz/caddy-docker-proxy`) — automatic Let's Encrypt HTTPS, serves the built frontend as static files, reverse-proxies `/api`, `/uploads`, `/ws` to the backend |
| Observability | Prometheus, Alertmanager, Grafana, Loki + Promtail, plus Postgres/Redis/Node/Blackbox exporters |
| Infra | Docker Compose (single `docker-compose.yml`) |

## Architecture

```
                              ┌───────────────────────────────┐
   Internet ── HTTPS :443 ──▶ │             Caddy               │
   (also :80 → https redirect)│  auto Let's Encrypt TLS,        │
   localhost :2828 (debug,───▶│  serves built frontend,         │
    plain HTTP, no TLS)       │  reverse-proxies /api /uploads/ws│
                              └────────────────┬────────────────┘
                                                │
                                                ▼
                              ┌───────────────────────────────┐
                              │       Backend (Express)        │──▶ SMTP (OTP/email, optional)
                              │  exposes /metrics + /health    │──▶ Google OAuth
                              └───┬─────────────┬───────────┬──┘
                                  ▼             ▼           ▼
                          ┌────────────┐  ┌──────────┐ ┌───────────┐
                          │ PostgreSQL │  │  Redis   │ │  Piston   │
                          │  (data)    │  │ (cache + │ │ (code exec│
                          │            │  │rate-limit│ │ commented │
                          │            │  │ store)   │ │ out by    │
                          │            │  │          │ │ default)  │
                          └────────────┘  └──────────┘ └───────────┘

   Observability (separate containers, see docker-compose.yml):
   Prometheus + Alertmanager + exporters ─▶ Grafana ◀─ Loki ◀─ Promtail (container logs)
```

Images (question/option images) are stored directly as `bytea` rows in PostgreSQL and served from `GET /api/images/:id` — no external file host required, and uploads survive backend restarts/redeploys/scaling.

## Getting Started

### Option A: Docker Compose (recommended)

Prerequisites: [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

The root `docker-compose.yml` is a **single, production-shaped file** — it brings up Postgres, Redis, the backend, a one-shot frontend build, the full observability stack, and Caddy as the public edge with automatic HTTPS. There is no separate "dev" compose file; local vs. production is controlled entirely by which `.env` values you set (see below).

```bash
git clone <this-repo-url>
cd campus-track

cp .env.example .env
```

Edit the root `.env`. Compose will refuse to start until these are set:

- `POSTGRES_PASSWORD`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `GRAFANA_ADMIN_PASSWORD` — generate each with `openssl rand -base64 32` (or similar).
- `DOMAIN` — only matters for real HTTPS traffic (see below); for pure local testing you can leave the placeholder value in place.

**`backend/.env` is not used at all in this path** — Docker reads everything from the root `.env` via `docker-compose.yml`'s `environment:` blocks. Don't bother copying `backend/.env.example` unless you're using Option B.

```bash
docker compose up --build
```

This starts Postgres, Redis, the backend API, runs database migrations automatically via `backend-init`, builds the frontend, and starts Caddy.

- **Local/testing access** (no DNS or public IP needed): `http://localhost:2828` (the port `DEBUG_PORT` in `.env.example` — plain HTTP, mirrors the full app, only reachable from this machine).
- **Real HTTPS access**: `https://<your DOMAIN value>` — this only works once DNS for that domain points at a public IP this host owns and ports 80/443 are reachable from the internet (Caddy needs both to complete the Let's Encrypt challenge). Don't expect this to work against a `localhost`-only setup.
- Grafana: `http://localhost:3001` (loopback-only; see [Observability](#observability)).
- There is **no exposed Postgres port and no bundled pgAdmin** — connect with `docker compose exec postgres psql -U postgres -d campustrack`, or add your own pgAdmin/DB client pointed at that container if you want a GUI.

Code execution ("Run Code" / coding-test grading) is **off by default** — the `piston` service is commented out in `docker-compose.yml`. To enable it, uncomment the `piston` service block and set `PISTON_API_URL=http://piston:2000/api/v2` in the backend's environment, then `docker compose up -d --build piston`. See [`infra/piston/README.md`](infra/piston/README.md) for what's baked into that image and how to add a language.

To verify your SMTP setup independently of the app (useful after editing
`.env`), run: `docker compose exec backend node scripts/test-smtp.js you@example.com` — it checks the credentials and sends a real test
email through the exact same code path the app uses for OTPs.

### Option B: Manual / local dev

Prerequisites: Node.js 20+, PostgreSQL 14+, Redis (optional but recommended).

```bash
# 1. Backend
cd backend
cp .env.example .env   # fill in DATABASE_URL, JWT secrets, SMTP, etc. —
                        # this file IS read directly here (Option B), unlike
                        # under Docker (Option A above)
npm install
npm run db:migrate     # creates all tables
npm run db:seed        # optional: sample data
npm run test:smtp -- you@example.com   # optional: verify SMTP creds work
npm run dev             # starts on :4400 with nodemon

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev              # starts on :5173, proxies /api and /uploads to :4400
```

Open http://localhost:5173.

For code execution under Option B, point `PISTON_API_URL` in `backend/.env` at any reachable Piston instance (e.g. one started standalone with `docker build infra/piston -t campustrack-piston && docker run --privileged -p 2000:2000 campustrack-piston`), or leave it unset — the backend falls back to `http://localhost:2000/api/v2` and "Run Code" will simply fail if nothing is listening there.

**Creating your first admin account:** register a user through the app's signup flow, then promote them directly in the database:

```sql
UPDATE users SET role = 'super_admin' WHERE email = 'you@yourcollege.edu';
```

## Environment Variables

There are **two separate `.env` files, read in mutually exclusive setups** — this is the single most common source of "why isn't my variable taking effect" confusion, so read this section before editing either.

| | Docker (Option A) | Manual (Option B) |
|---|---|---|
| File | root [`.env`](.env.example) | [`backend/.env`](backend/.env.example) |
| Read by | `docker-compose.yml` via `${VAR}` substitution | `dotenv`, loaded directly by the backend process |
| Required vars | `POSTGRES_PASSWORD`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `GRAFANA_ADMIN_PASSWORD`, `DOMAIN` (for real HTTPS) | `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET` |

Common optional vars (same meaning in either file):

| Variable | Notes |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For "Sign in with Google" (students). From [Google Cloud Console](https://console.cloud.google.com). |
| `REDIS_URL` | Falls back gracefully if unset, but see the rate-limiter note below — treat it as required for anything beyond solo local testing. |
| `PISTON_API_URL` | Where the backend sends code-execution requests. Not set by default under Docker (Piston is commented out — see [Getting Started](#getting-started)). |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | For email notifications, incl. password-reset OTPs. Leave blank to disable sending (no error, emails are just skipped). Verify with `node scripts/test-smtp.js you@example.com` (or `docker compose exec backend node scripts/test-smtp.js you@example.com`). |
| `VITE_API_URL` (frontend build arg) | Use a relative `/api` when frontend+backend share an origin (the default, via Caddy); use the full backend URL when hosted separately. |
| `APP_NAME`, `COLLEGE_NAME` | Cosmetic branding, baked into the frontend at build time. |

> **Security note:** never commit a real `.env` file. Rotate any secret that has ever been committed to source control or shared outside your team, even after removing it from the file.

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── controllers/   # Route handlers (auth, tests, submissions, analytics,
│   │   │                  # plagiarism, AI, gamification, drives, etc.)
│   │   ├── routes/        # Express route registration (single index.js)
│   │   ├── middleware/    # auth, rate limiting, validation, tenancy
│   │   ├── services/      # piston, email, scheduler, ai, plagiarism,
│   │   │                  # websocket, calendar, pdf reports, etc.
│   │   └── db/            # migrate.js (schema), seed.js, redis.js
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── admin/         # Admin dashboard, test creator, question bank,
│   │   │   │                  # results, analytics, plagiarism detection,
│   │   │   │                  # user management, drives, AI tools, resources
│   │   │   ├── student/       # Student dashboard, test interface, results,
│   │   │   │                  # leaderboard, resources
│   │   │   ├── Login.jsx      # Authentication with Google OAuth support
│   │   │   ├── Profile.jsx    # User profile management
│   │   │   └── CompleteProfile.jsx  # Profile completion flow
│   │   ├── components/shared/ # Reusable UI (Monaco editor, timers, code
│   │   │                      # playback, question previews, notifications, etc.)
│   │   └── services/api.js    # Axios client + all API method definitions
│   ├── nginx.conf          # Only used if you build the Dockerfile's final
│   │                       # `nginx` stage standalone — the root compose
│   │                       # stops at the `builder` stage and serves the
│   │                       # output via Caddy instead (see Architecture).
│   └── Dockerfile
├── infra/
│   ├── piston/             # Self-hosted Piston image (languages baked in)
│   ├── prometheus/         # Scrape config + alert rules
│   ├── grafana/            # Provisioned datasources + dashboards
│   ├── loki/, promtail/    # Log aggregation config
│   └── *.md                # Scaling / alternate deployment-strategy notes
├── scripts/                # Maintenance / one-off scripts (see Deploying
│                           # to Production for a caveat on deploy-blue-green.sh)
├── tests/                  # Playwright e2e suite
├── DEPLOYMENT.md           # Blue-green + nginx deployment guide (alternate
│                           # path — see Deploying to Production)
└── docker-compose.yml      # The single compose file used by Option A
```

## Image Uploads

Question and option images are uploaded via `POST /api/upload/image` (admin-only), stored as `bytea` rows in the `images` Postgres table, and served publicly (no auth header needed, same as a static file) from `GET /api/images/:id` with long-lived cache headers. This means:

- Images survive backend restarts, redeploys, and horizontal scaling — nothing is written to local disk.
- No third-party file host (S3, Cloudinary, etc.) or extra credentials are needed.
- Uploads work correctly whether the frontend and backend share a domain or are hosted separately (the frontend resolves the image URL against the API's own origin, not the page's origin).

## Supported Coding Languages

**Python, JavaScript, Java, C, C++, and SQL** — this is the exact set baked into the Piston image at `infra/piston/Dockerfile` and mapped in `backend/src/services/piston.js`'s `LANGUAGE_MAP`. Adding another language means updating both files (and re-building the Piston image) — see [`infra/piston/README.md`](infra/piston/README.md).

For SQL problems, put the schema-setup + sample data (e.g. `CREATE TABLE` / `INSERT` statements) in each test case's **input**, and have students write only their query as their **answer**. The grading harness concatenates the two before executing, so the student's query always runs against a freshly-seeded database, and the printed query result is compared against the test case's expected output — the same model used for every other language.

Admins can restrict which languages are available per test under **Test Settings → Allowed Coding Languages**.

Remember Piston itself is **not running by default** under Docker Compose — see [Getting Started](#getting-started) for how to turn it on.

## Observability

The root `docker-compose.yml` brings up a full metrics + logging stack alongside the app — none of this is optional infrastructure bolted on separately, it's part of the same `docker compose up`:

- **Prometheus** scrapes the backend's `GET /metrics` endpoint plus `postgres-exporter`, `redis-exporter`, `node-exporter`, and `blackbox-exporter` (the last one probes an external Piston load balancer, if you run one — see `infra/prometheus/prometheus.yml`). Alert rules live in `infra/prometheus/alerts.yml` and route through **Alertmanager**.
- **Loki + Promtail** ship every container's `docker logs` output centrally, keyed by container name.
- **Grafana** (`http://localhost:3001`, loopback-only by design) has both datasources pre-provisioned (`infra/grafana/datasources`) and comes with dashboards under `infra/grafana/dashboards`. Log in with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` from your `.env`.

To reach Grafana from outside the host: `ssh -L 3001:localhost:3001 <host>` then open `http://localhost:3001` locally, or add a `caddy_N` label block to the `caddy` service (mirroring the `backend` service's labels in `docker-compose.yml`) to publish it on its own subdomain instead.

## Deploying to Production

The root `docker-compose.yml` **is** the production deployment — there is no separate `docker-compose.prod.yml`. The only thing that changes between a local trial and a real production deploy is your `.env`:

1. Provision a server with a public IP, point a real DNS **A record** at it, and set `DOMAIN` in `.env` to that hostname — Caddy requests and renews its own Let's Encrypt certificate automatically the moment it can complete an HTTP-01 challenge on port 80.
2. Set every required var (see [Environment Variables](#environment-variables)) with real, freshly-generated secrets — not the placeholder values from `.env.example`.
3. Open ports 80 and 443 to the internet (and optionally your `DEBUG_PORT`, restricted, if you want direct non-TLS host access for diagnostics).
4. `docker compose up -d --build`. Migrations run automatically via `backend-init`.
5. If you want code execution in production, uncomment the `piston` service and set `PISTON_API_URL` — see [Getting Started](#getting-started).

**A separate, more elaborate path exists in [`DEPLOYMENT.md`](DEPLOYMENT.md)**, describing a blue-green rollout behind nginx with GitHub Actions-driven, human-approved traffic flips (`scripts/deploy-blue-green.sh`). The blue-green nginx config is available at `infra/blue-green-nginx.conf`. This is a more advanced deployment strategy suitable for high-availability production environments.

## Backing Up & Restoring Data

Postgres has **no host-exposed port** in `docker-compose.yml`, so back it up through the container rather than a local `pg_dump` pointed at `localhost`:

```bash
# Dump the running database to a local file:
docker compose exec -T postgres pg_dump -U postgres -d campustrack --no-owner --no-privileges > backup.sql

# Restore into a (fresh or existing) target database:
cat backup.sql | docker compose exec -T postgres psql -U postgres -d campustrack
```

For moving data to a different server entirely, copy `backup.sql` over first, then run the restore command there. Always take a fresh dump immediately before cutting over, and verify row counts (`SELECT COUNT(*) FROM tests;`, `SELECT COUNT(*) FROM users WHERE role != 'student';`, etc.) on the restored database before pointing production traffic at it.

## Troubleshooting

- **Password-reset OTP / other emails never arrive** — the API always replies with a generic success message ("If that email exists...") even when sending silently failed, to avoid leaking which emails are registered — so check the *actual* delivery path instead of the UI response. Run `node scripts/test-smtp.js you@example.com` (from `backend/`, or `docker compose exec backend node scripts/test-smtp.js you@example.com` under Docker) to verify credentials and send a real test message.
- **"Run Code" / coding submissions fail immediately** — Piston is commented out in `docker-compose.yml` by default. Confirm the `piston` service is running (`docker compose ps`) and `PISTON_API_URL` is set on the backend; see [Getting Started](#getting-started) and [`infra/piston/README.md`](infra/piston/README.md).
- **Images not showing up** — make sure the migration ran (`images` table must exist) and that `VITE_API_URL` is correct for your deployment topology (see [Environment Variables](#environment-variables)).
- **"Not found" errors on an admin page** — usually means the frontend and backend versions are out of sync (an older frontend build calling a route that doesn't exist yet, or vice versa); rebuild/redeploy both together (`docker compose up -d --build`).
- **A newly created admin can't see a colleague's tests** — confirm both accounts have `role = 'admin'` or `'super_admin'` in the `users` table; only the `student` role is scoped to published tests in their department.
- **Need a database GUI** — there's no bundled pgAdmin anymore; run one yourself pointed at the `postgres` container, or use `docker compose exec postgres psql -U postgres -d campustrack` for ad-hoc queries.
- **Setting an SSO/LMS/ATS/payment env var does nothing** — those integrations aren't implemented yet (see the note under [Features](#features)); the env vars and, in some cases, DB tables are scaffolded but not wired to any route or service.

## License

Proprietary — internal use for your institution unless you specify otherwise.
