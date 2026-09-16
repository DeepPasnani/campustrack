#!/bin/bash
set -euo pipefail

# ============================================================
# Sentry Error Tracking Setup
#
# This script sets up Sentry for both backend and frontend.
# It creates .env entries and installs required packages.
#
# Prerequisites:
#   - Sentry account (https://sentry.io)
#   - Create a project for backend (Node.js/Express)
#   - Create a project for frontend (React/Vite)
#   - Copy DSNs from Project Settings → Client Keys (DSN)
# ============================================================

echo "═══ Sentry Setup ═══════════════════════════════════"

# ── Check for existing DSNs ──────────────────────────────
BACKEND_DSN="${SENTRY_BACKEND_DSN:-}"
FRONTEND_DSN="${SENTRY_FRONTEND_DSN:-}"

if [ -z "$BACKEND_DSN" ]; then
  echo ""
  echo "Enter your Sentry Backend DSN (Node.js/Express):"
  echo "  (find at sentry.io → Settings → Projects → [your project] → Client Keys)"
  read -r BACKEND_DSN
fi

if [ -z "$FRONTEND_DSN" ]; then
  echo ""
  echo "Enter your Sentry Frontend DSN (React/Vite):"
  echo "  (find at sentry.io → Settings → Projects → [your project] → Client Keys)"
  read -r FRONTEND_DSN
fi

# ── Backend setup ────────────────────────────────────────
echo ""
echo "Installing @sentry/node in backend..."
cd ../backend
npm install @sentry/node @sentry/tracing

# Add Sentry init to backend/.env
if ! grep -q "SENTRY_DSN" .env 2>/dev/null; then
  echo "" >> .env
  echo "# Sentry Error Tracking" >> .env
  echo "SENTRY_DSN=${BACKEND_DSN}" >> .env
  echo "SENTRY_ENVIRONMENT=production" >> .env
  echo "  ✓ Added SENTRY_DSN to backend/.env"
else
  echo "  ✓ SENTRY_DSN already in backend/.env"
fi

# ── Frontend setup ───────────────────────────────────────
echo ""
echo "Installing @sentry/react in frontend..."
cd ../frontend
npm install @sentry/react @sentry/vite-plugin

# Add Sentry init to frontend/.env
if ! grep -q "VITE_SENTRY_DSN" .env 2>/dev/null; then
  echo "" >> .env
  echo "# Sentry Error Tracking" >> .env
  echo "VITE_SENTRY_DSN=${FRONTEND_DSN}" >> .env
  echo "  ✓ Added VITE_SENTRY_DSN to frontend/.env"
else
  echo "  ✓ VITE_SENTRY_DSN already in frontend/.env"
fi

echo ""
echo "═══ Setup Complete ═══════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Add Sentry initialization to backend/src/index.js:"
echo ""
echo '     const Sentry = require("@sentry/node");'
echo '     Sentry.init({'
echo '       dsn: process.env.SENTRY_DSN,'
echo '       environment: process.env.SENTRY_ENVIRONMENT || "development",'
echo '       tracesSampleRate: 0.1,'
echo '     });'
echo '     app.use(Sentry.Handlers.requestHandler());'
echo '     app.use(Sentry.Handlers.errorHandler());'
echo ""
echo "  2. Add Sentry initialization to frontend/src/main.jsx:"
echo ""
echo '     import * as Sentry from "@sentry/react";'
echo '     Sentry.init({'
echo '       dsn: import.meta.env.VITE_SENTRY_DSN,'
echo '       environment: import.meta.env.MODE,'
echo '       tracesSampleRate: 0.1,'
echo '     });'
echo ""
echo "  3. Restart both services to enable error tracking."
