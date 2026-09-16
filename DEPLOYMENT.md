# CampusTrack — Production Deployment Guide

Blue-green deployment behind nginx, with GitHub Actions handling build,
test, and a human-approved traffic flip. This guide assumes you're
starting from a fresh server and an empty GitHub Actions setup.

**Read this once end-to-end before running anything** — Part 1 and Part 2
are manual, one-time steps that must be done *before* the CI/CD pipeline
in Part 3 can deploy anything. The pipeline only knows how to build and
promote to whichever color is currently idle; it doesn't know how to
create the nginx container or the first "blue" environment from nothing.

---

## Architecture at a glance

```
                         ┌─────────────────┐
  Internet ── HTTPS ──▶  │   nginx (edge)   │  terminates TLS, serves the
                         │  infra/blue-     │  built frontend, load-
                         │  green-nginx.conf│  balances to whichever
                         └────────┬─────────┘  color is active
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                  ▼
        ┌──────────────────┐              ┌──────────────────┐
        │  backend-blue     │              │  backend-green    │
        │  (N replicas)     │              │  (N replicas)     │
        │  ACTIVE           │              │  idle / being      │
        │                   │              │  deployed to next  │
        └────────┬──────────┘              └─────────┬─────────┘
                 │                                    │
                 └───────────────┬────────────────────┘
                                  ▼
                  postgres · redis · piston (shared)
```

Only one color receives live traffic at a time. Deploys build and
health-check the *other* color first, with zero effect on production,
and a separate approval step flips nginx over to it. Rolling back is the
same flip in reverse — no rebuild required.

---

## Prerequisites

- A Linux server (Ubuntu 22.04/24.04 recommended) with a public IP,
  at least 2 vCPUs / 4 GB RAM for a small deployment (more if you expect
  heavy concurrent code-execution load via Piston).
- A domain name you control, able to point an A record at that IP.
- Root or sudo SSH access to the server.
- A GitHub repository containing this project (with the files from the
  zip merged in: `docker-compose.blue-green.yml`,
  `infra/blue-green-nginx.conf`, `scripts/deploy-blue-green.sh`,
  `.github/workflows/*.yml`, the rate-limit fix under
  `backend/src/middleware/`).
- Ability to create repository secrets and environments in GitHub
  (requires admin access on the repo).

---

## Part 1 — One-time server setup

### 1.1 Provision the server and install Docker

SSH into the fresh server and install Docker Engine + the Compose plugin:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Run docker without sudo (log out/in afterwards for this to take effect)
sudo usermod -aG docker $USER
```

Open the required firewall ports (adjust if you use a cloud provider's
security groups instead of `ufw`):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 1.2 Point DNS at the server

At your DNS provider, create an **A record** for your domain (and
optionally `www`) pointing at the server's public IP. Wait for it to
propagate — check with:

```bash
dig +short your-domain.com
```

### 1.3 Obtain a TLS certificate

Both `docker-compose.lb.yml` and `docker-compose.blue-green.yml` mount
`/etc/letsencrypt` read-only into the nginx container, and
`infra/blue-green-nginx.conf` / `infra/nginx/nginx.conf` reference
certificate paths under it. The simplest way to get real certs before
any of your own containers are listening on port 80:

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d your-domain.com -d www.your-domain.com
```

This writes certs to `/etc/letsencrypt/live/your-domain.com/`. Update the
`ssl_certificate` / `ssl_certificate_key` paths in
`infra/blue-green-nginx.conf` to match if they differ. Certbot installs a
systemd timer for renewal automatically; confirm it exists:

```bash
sudo systemctl list-timers | grep certbot
```

### 1.4 Clone the repository

Pick a fixed, stable path — the CI/CD pipeline's `DEPLOY_PATH` secret
must match this exactly.

```bash
sudo mkdir -p /opt/campustrack
sudo chown $USER:$USER /opt/campustrack
git clone <your-repo-url> /opt/campustrack
cd /opt/campustrack
```

### 1.5 Configure environment variables

There are **two separate `.env` files** and they are not interchangeable
— see the comment block at the top of `.env.example` for why.

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Edit the root `.env` (read by Docker Compose via `${VAR}` substitution —
this is the one that actually matters when running via Docker):

| Variable | Required? | Notes |
|---|---|---|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Optional | Leave blank to disable email (OTPs/notifications silently skipped). For Gmail, use an [App Password](https://myaccount.google.com/apppasswords). |
| `EMAIL_FROM` | Optional | Only used if SMTP is configured. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional | Enables "Sign in with Google". Create at the [Google Cloud Console](https://console.cloud.google.com). Add `https://your-domain.com` as an authorized origin. |
| `OPENAI_API_KEY` | Optional | Powers AI question generation/hints/feedback. Leave blank to disable those features. |

Edit `backend/.env` for the secrets that don't have Docker-Compose
defaults:

```bash
# Generate strong random values — do not use the repo's example values:
openssl rand -hex 32   # use for JWT_SECRET
openssl rand -hex 32   # use for REFRESH_TOKEN_SECRET
```

Set `JWT_SECRET` and `REFRESH_TOKEN_SECRET` in `backend/.env` to the
generated values, and also export them for Compose to pick up (the
blue-green compose file requires them to be set or it will refuse to
start):

```bash
echo 'JWT_SECRET=<paste generated value>' >> .env
echo 'REFRESH_TOKEN_SECRET=<paste generated value>' >> .env
```

### 1.6 Replace the default database password

`docker-compose.yml` currently hardcodes
`POSTGRES_PASSWORD: postgres_password_change_me` directly in the file
(not pulled from `.env`), and the same literal string is repeated in the
`backend`, `backend-init`, `postgres-exporter`, `backend-blue`, and
`backend-green` service definitions as part of their `DATABASE_URL`. This
is fine for local dev but **must be changed before exposing the app
publicly**, since anyone with read access to the repo can see it.

Pick a strong password, then replace every occurrence across every
compose file in one pass:

```bash
NEW_PW=$(openssl rand -hex 24)
grep -rl 'postgres_password_change_me' *.yml | xargs sed -i "s/postgres_password_change_me/${NEW_PW}/g"
```

Do this **before** the first `docker compose up` — changing it after
Postgres has already initialized its data volume with the old password
requires either resetting the volume or updating the password inside
Postgres itself.

---

## Part 2 — One-time bootstrap of the blue-green stack

This is the step that creates the nginx container and the first ("blue")
backend pool. The CI/CD pipeline in Part 3 can only promote code to
whichever color is currently idle — it has nothing to promote *to* until
this has run once.

### 2.1 Generate the active nginx config

```bash
cd /opt/campustrack
chmod +x scripts/deploy-blue-green.sh
./scripts/deploy-blue-green.sh init your-domain.com
```

This writes `infra/nginx-active.conf` (routing to blue, with your domain
substituted in) and `.deploy-state` (containing `blue`). Both are
git-ignored — they're server-local runtime state, not source.

### 2.2 Bring the stack up

The `init` command prints the exact command to run next; it looks like
this:

```bash
docker compose -f docker-compose.yml -f docker-compose.blue-green.yml \
  up -d --build --scale backend-blue=3 --scale backend-green=0 \
  postgres redis piston1 piston2 piston3 piston-lb \
  backend-init backend-blue backend-green frontend-dist nginx
```

What this does:
- Starts `postgres`, `redis`, and the 3-instance `piston` code-execution
  cluster.
- Runs `backend-init` once to apply database migrations.
- Builds and starts **3 replicas** of `backend-blue`, **0** of
  `backend-green` (defined but not started yet).
- Builds the frontend and copies its compiled output into the
  `frontend_dist` volume via the one-shot `frontend-dist` job.
- Starts the `nginx` edge container, serving that frontend and routing
  API/WS traffic to `backend-blue`.

### 2.3 Verify

```bash
./scripts/deploy-blue-green.sh status
```

Expected output: `Active environment: blue`, `backend-blue: 3/3 replica(s)
healthy`, `backend-green: no replicas running`. Then confirm from outside
the server:

```bash
curl -I https://your-domain.com
```

You should get a `200` (or a redirect to the app) with a valid
certificate. Open the site in a browser and log in to fully confirm.

---

## Part 3 — GitHub Actions setup

### 3.1 Generate a deploy key

On your local machine (not the server), generate a dedicated key pair
used only for deployments:

```bash
ssh-keygen -t ed25519 -C "campustrack-deploy" -f campustrack_deploy_key -N ""
```

Add the **public** key to the server:

```bash
ssh-copy-id -i campustrack_deploy_key.pub <your-user>@your-server-ip
# or manually append campustrack_deploy_key.pub to ~/.ssh/authorized_keys on the server
```

Keep the **private** key (`campustrack_deploy_key`, no extension) — it
goes into GitHub in the next step. Delete both files from your local
machine once added.

### 3.2 Add repository secrets

In GitHub: **Settings → Secrets and variables → Actions → New repository
secret**. Add each of these:

| Secret name | Value |
|---|---|
| `DEPLOY_HOST` | Server's IP address or hostname |
| `DEPLOY_USER` | The SSH user (e.g. `ubuntu`) |
| `DEPLOY_SSH_KEY` | Full contents of the private key file from 3.1 |
| `DEPLOY_PATH` | `/opt/campustrack` (must match Part 1.4 exactly) |

### 3.3 Create the `production` environment with required reviewers

This is what makes the traffic flip wait for a human, instead of going
live automatically the moment tests pass.

1. **Settings → Environments → New environment**, name it exactly
   `production` (the workflow files reference this name directly).
2. Under **Deployment protection rules**, enable **Required reviewers**
   and add yourself and/or teammates.
3. Save.

### 3.4 Confirm the workflow files are present

Merge these into your repo if you haven't already (from the earlier
zip):

```
.github/workflows/ci.yml
.github/workflows/deploy.yml
.github/workflows/rollback.yml
```

Push them to `main`. No further setup needed — `ci.yml` runs on every
push/PR automatically, and `deploy.yml` triggers itself once `ci.yml`
finishes successfully on `main`.

---

## Part 4 — Day-to-day deploy flow

1. **Open a PR** with your changes. `ci.yml` runs automatically: syntax
   checks, a frontend build check, and the full Playwright e2e suite
   against a real docker-compose stack.
2. **Merge to `main`** once CI is green.
3. **`deploy.yml` triggers automatically.** Its first job,
   `deploy-inactive`, SSHes to the server, reads `.deploy-state` to find
   the idle color, checks out the new commit, and runs:
   ```bash
   ./scripts/deploy-blue-green.sh deploy <idle-color> 3
   ```
   This builds the new image, scales the idle color up to 3 replicas,
   waits for every replica's Docker healthcheck to pass, then runs a
   smoke test (`GET /health`) against each one — all with **zero effect
   on live traffic**, which is still being served entirely by the active
   color.
4. **Review before approving.** Open the Actions run, check the
   `deploy-inactive` job's logs for "N replica(s) healthy" and no smoke
   test failures.
5. **Approve the flip.** The second job, `flip-traffic`, is waiting under
   the `production` environment. Click **Review deployments → Approve
   and deploy**. This runs:
   ```bash
   ./scripts/deploy-blue-green.sh flip <idle-color>
   ```
   nginx reloads (not restarts — zero dropped connections) pointing at
   the new color. Traffic is live on the new version within seconds.
6. **Verify in production.** Load the real site, exercise a login and
   whatever the change affects.
7. **Scale down the now-idle color** once you're confident (optional, but
   avoids paying for two full pools indefinitely):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.blue-green.yml \
     up -d --scale backend-<now-idle-color>=0 backend-<now-idle-color>
   ```
   Leave it scaled to at least 1 if you'd rather keep instant-rollback
   capacity warm; scaling to 0 means the *next* deploy has to build and
   warm it up from cold again.

---

## Part 5 — Rolling back

If something's wrong after a flip, no rebuild is needed — the previous
color is (usually) still running.

1. GitHub → **Actions → Rollback → Run workflow**.
2. This runs `./scripts/deploy-blue-green.sh rollback`, which reads
   `.deploy-state.previous` and flips straight back. No approval gate —
   it's designed to be as fast as possible during an incident.
3. Confirm with `./scripts/deploy-blue-green.sh status` (via SSH) or by
   reloading the site.

If you'd previously scaled the old color down to 0 replicas, rollback
will still work, but nginx will briefly have 0 healthy upstreams for that
color until Compose restarts at least one — for anything customer-facing,
prefer keeping the previous color at ≥1 replica for a while after each
flip.

---

## Part 6 — Ongoing maintenance

- **Certificate renewal** is handled by certbot's systemd timer (1.3) —
  confirm periodically with `sudo certbot renew --dry-run`. After
  renewal, reload nginx so it picks up the new cert:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.blue-green.yml exec nginx nginx -s reload
  ```
- **Database backups** — this guide doesn't cover them; at minimum,
  schedule `pg_dump` against the `postgres` container on a cron job
  before relying on this in production.
- **Redis is required, not optional, in this topology** — the rate
  limiter fix (`redisRateLimitStore.js`) depends on it to keep login/API
  limits consistent across replicas and across the blue/green flip. If
  Redis goes down, the limiter fails open (allows requests) rather than
  blocking everyone, but you lose rate-limit protection until it's back.
- **Piston capacity** — code-execution load scales with how many students
  are actively coding at once; watch `piston-lb` and its 3 upstream
  instances under load and add replicas if submissions start queuing.

---

## Troubleshooting

**`deploy-blue-green.sh` hangs on an SSH step in Actions**
The runner is waiting for interactive input — usually a host-key prompt
or a passphrase-protected key. Confirm `DEPLOY_SSH_KEY` has no passphrase
and that `ssh-keyscan` succeeded (check the "Trust deploy host" step's
log).

**`flip` fails with `nginx: [emerg] host not found`**
The target color has 0 healthy replicas — Docker's DNS won't resolve a
service name with no running containers. Run `deploy` (not `flip`) for
that color first and confirm `status` shows it healthy before flipping.

**Both colors show unhealthy after a fresh `init`**
Check `docker compose ... logs backend-blue` — most often this is a
missing `JWT_SECRET`/`REFRESH_TOKEN_SECRET` (Part 1.5) or the database
password mismatch from skipping Part 1.6 after Postgres already
initialized its volume with different credentials.

**CI passes but `deploy.yml` never triggers**
`workflow_run` only fires for workflows on the default branch matching
the `branches:` filter (`main`) — confirm `ci.yml` actually ran against
`main` (not a PR) and finished with a green checkmark, not just
"completed" with a failure.

**Certbot renewal port conflict**
`certbot renew` using the `--standalone` method needs port 80 free; since
nginx now owns 80/443, switch to the `webroot` method pointed at a path
served by the nginx container, or use `certbot --nginx` against the
container's exposed config instead of `--standalone` for renewals.

---

## Command reference

```bash
# One-time
./scripts/deploy-blue-green.sh init <domain>

# Deploy new code to the idle color (build + scale + health/smoke test)
./scripts/deploy-blue-green.sh deploy <blue|green> [replica-count]

# Send live traffic to a color (requires it to already be healthy)
./scripts/deploy-blue-green.sh flip <blue|green>

# Flip back to whatever was active before the last flip
./scripts/deploy-blue-green.sh rollback

# Show which color is active and per-replica health of both
./scripts/deploy-blue-green.sh status

# Scale a color's replica count directly
docker compose -f docker-compose.yml -f docker-compose.blue-green.yml \
  up -d --scale backend-<color>=<N> backend-<color>

# Tail logs for a color
docker compose -f docker-compose.yml -f docker-compose.blue-green.yml \
  logs -f backend-<color>

# Reload nginx after a manual config or cert change
docker compose -f docker-compose.yml -f docker-compose.blue-green.yml \
  exec nginx nginx -s reload
```
