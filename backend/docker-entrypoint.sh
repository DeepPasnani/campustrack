#!/bin/sh
set -e

mkdir -p /app/uploads/images
echo "Starting server..."
exec node src/index.js
