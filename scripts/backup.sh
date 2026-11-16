#!/usr/bin/env bash
# Sauvegarde de la base et des photos : ./scripts/backup.sh
# À planifier chaque nuit : crontab -e  →  30 3 * * * cd /opt/esnaours && ./scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M)
docker compose exec -T app node -e "const {db}=require('./src/db'); db.exec(\"VACUUM INTO '/app/data/backup.db'\")"
tar -czf "backups/esnaours-$STAMP.tar.gz" -C data backup.db uploads
rm -f data/backup.db
# garde les 14 dernières sauvegardes
ls -1t backups/esnaours-*.tar.gz | tail -n +15 | xargs -r rm --
echo "Sauvegarde : backups/esnaours-$STAMP.tar.gz"
