# Blue-Green Deployment Strategy

## Overview

CampusTrack uses a blue-green deployment pattern to achieve zero-downtime
deployments with instant rollback capability.

Two identical production environments run simultaneously:
- **Blue** (port 5000) — currently active, serving user traffic
- **Green** (port 5001) — inactive, ready for deployment

## Architecture

```
                    ┌──────────────┐
                    │    nginx     │  ← Routes traffic to ACTIVE environment
                    │ (port 443)   │
                    └──────┬───────┘
                    ┌──────┴───────┐
                    │  __ACTIVE__  │  ← Set by deploy script
                    └──────┬───────┘
            ┌──────────────┼──────────────┐
            │              │              │
    ┌───────▼───────┐ ┌───▼────────┐ ┌───▼────────┐
    │  Backend Blue │ │ Backend    │ │ Backend    │
    │  (port 5000)  │ │ Green      │ │ (future N) │
    └───────────────┘ │ (port 5001) │ └────────────┘
                      └─────────────┘
```

## Deployment Flow

### 1. Deploy New Version to Inactive Environment

```bash
# Current state: Blue is active, Green is inactive
./scripts/deploy-blue-green.sh green
```

This:
1. Pulls the latest Docker images
2. Rebuilds and starts the Green environment on port 5001
3. Runs health checks (up to 30 retries, 5 seconds apart)
4. Runs smoke tests (login, health, API endpoints)
5. If healthy: marks deployment successful, ready for traffic flip

### 2. Flip Traffic

```bash
./scripts/deploy-blue-green.sh flip
```

This:
1. Updates the nginx config to point upstream to the Green environment
2. Reloads nginx (zero-downtime via `nginx -s reload`)
3. Saves new state to `.deploy-state`
4. Blue environment remains running for instant rollback

### 3. Verify

```bash
# Check that traffic is flowing to the new environment
curl https://your-domain.com/health

# Monitor Grafana for any anomalies
```

### 4. Clean Up (optional)

After verifying the new deployment is stable (e.g., 24 hours):

```bash
# Stop the old Blue environment to free resources
docker compose -f docker-compose.blue-green.yml stop backend-blue
```

## Rollback Procedure

If the new deployment has issues, rollback is instantaneous:

```bash
# Flip traffic back to the previous environment
./scripts/deploy-blue-green.sh rollback
```

This takes < 1 second (just an nginx reload). The old environment is still
running with the previous version.

## Docker Compose for Blue-Green

Create `docker-compose.blue-green.yml`:

```yaml
services:
  backend-blue:
    build: ./backend
    container_name: pp_backend_blue
    environment:
      PORT: 5000
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "5000:5000"
    networks:
      - campustrack
    restart: unless-stopped

  backend-green:
    build: ./backend
    container_name: pp_backend_green
    environment:
      PORT: 5001
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "5001:5001"
    networks:
      - campustrack
    restart: unless-stopped

  frontend:
    build: ./frontend
    container_name: pp_frontend
    ports:
      - "80:80"
    networks:
      - campustrack
    restart: unless-stopped

networks:
  campustrack:
    external: true
```

## Health Check Endpoints

- `/health` — Basic health (DB + Redis + Read Replica)
- `/metrics` — Prometheus metrics
- `/api/health` — API health

## Smoke Tests

Run automatically after each deployment:

```bash
# Manual smoke test
curl -f http://localhost:5000/health
curl -f -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.edu","password":"testpass123"}'
```

## Monitoring During Deployment

- **Grafana dashboard**: Watch request rate, p99 latency, error rate
- **Sentry**: Check for new errors after deployment
- **Loki**: Search logs for 5xx errors or anomalies
- **Prometheus alerts**: Automated alerts for high error rate or latency

## Rollback Checklist

1. Run `./scripts/deploy-blue-green.sh rollback`
2. Verify nginx reloaded: `nginx -t && systemctl status nginx`
3. Check health: `curl https://your-domain.com/health`
4. Monitor Grafana for recovery
5. Investigate what went wrong in the new version

## CI/CD Integration

The GitHub Actions workflow (`.github/workflows/ci.yml`) automates:

1. On push to `main`:
   - Runs lint + type-check
   - Runs Playwright E2E tests
   - Builds Docker images
   - Pushes to GitHub Container Registry (ghcr.io)
   - Deploys via SSH to production

2. On successful deployment:
   - Flip traffic to new version
   - Run smoke tests against production
