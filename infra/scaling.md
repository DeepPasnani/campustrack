# Horizontal Scaling for CampusTrack

## Overview

The backend is designed to be stateless, allowing horizontal scaling to handle
1000+ concurrent test-takers. Each instance shares state via PostgreSQL and Redis.

## Statelessness Check

| Component | Status | Notes |
|---|---|---|
| Session store | ✅ Stateless | Uses `connect-pg-simple` (PostgreSQL-backed sessions) |
| Auth tokens | ✅ Stateless | JWT-based, no server-side session needed |
| WebSocket | ✅ Stateless | Heartbeat tracked in Redis; no per-instance state |
| File uploads | ✅ Stateless | Uploaded to Cloudinary (external service) |
| User cache | ✅ Shared | Redis-backed, all instances share same cache |
| Rate limiting | ✅ Shared | Redis-backed via `express-rate-limit` |
| Code execution | ✅ Stateless | Docker runner spawns containers per request |

## Scaling Architecture

```
                         ┌─────────────┐
                         │   nginx     │  (round-robin load balancer)
                         └──────┬──────┘
                    ┌───────────┼───────────┐
                    │           │           │
              ┌─────▼────┐ ┌───▼────┐ ┌───▼────┐
              │ Backend 1│ │Backend 2│ │Backend N│  (stateless Express)
              └─────┬────┘ └───┬────┘ └───┬────┘
                    │           │           │
         ┌──────────┴───────────┴───────────┴──────────┐
         │                                              │
    ┌────▼─────┐                                  ┌────▼─────┐
    │PostgreSQL│  (primary + read replicas)        │  Redis   │  (shared cache + pub/sub)
    └──────────┘                                  └──────────┘
```

## Scaling Up

### Docker Compose (single machine)

Edit `docker-compose.yml` to run multiple backend replicas:

```yaml
services:
  backend:
    build: ./backend
    deploy:
      replicas: 3
    environment:
      PORT: 5000
      # All instances share DB + Redis URLs
    # No ports exposed individually — nginx handles routing
```

### Docker Swarm / Kubernetes

```bash
# Docker Swarm
docker service create \
  --name campustrack-backend \
  --replicas 5 \
  --network campustrack \
  --env DATABASE_URL=... \
  --env REDIS_URL=... \
  campustrack-backend:latest
```

### Environment Variables for Scaling

| Variable | Purpose |
|---|---|
| `PORT` | Each instance needs a unique port (or Docker handles it) |
| `DATABASE_URL` | Shared PostgreSQL connection string |
| `DATABASE_URL_READ` | Read replica connection string for dashboard queries |
| `REDIS_URL` | Shared Redis connection string |
| `JWT_SECRET` | Must be identical across all instances |
| `NODE_ENV` | Set to `production` |

## Auto-scaling (Kubernetes HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: campustrack-backend
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: campustrack-backend
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

## Load Testing Before Scaling

Use the built-in load test:

```bash
# Simulate 150 concurrent users for 60 seconds
node scripts/load-test.js --concurrency 150 --duration 60 --url http://localhost:5000
```

## Database Connection Pool Tuning

Each backend instance needs its own pool connections. With 10 instances:

- `max: 20` per instance = 200 total connections to primary
- Read replica pool: `max: 30` per instance = 300 total connections

Adjust `max` settings in `backend/src/db/index.js` based on PostgreSQL's
`max_connections` setting and available RAM.

## Monitoring During Scaling

- Prometheus + Grafana dashboard shows per-instance metrics
- Loki aggregates logs across all instances
- Key metrics to watch: connection pool saturation, p99 latency, error rate
