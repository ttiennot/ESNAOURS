#!/usr/bin/env bash
# Mise à jour du site sur le VPS : ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
mkdir -p data && chown -R 1000:1000 data 2>/dev/null || true
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
