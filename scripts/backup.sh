#!/usr/bin/env bash
set -euo pipefail
umask 077

cd /opt/puedoayudar.co
set -a
source .env
set +a

backup_dir="/opt/puedoayudar.co/backups"
install -d -m 700 "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

docker compose exec -T db mysqldump \
  --single-transaction \
  --quick \
  --lock-tables=false \
  -uroot \
  "-p${MYSQL_ROOT_PASSWORD}" \
  "$MYSQL_DATABASE" | gzip -9 > "$backup_dir/mysql-${timestamp}.sql.gz"

find "$backup_dir" -type f -name 'mysql-*.sql.gz' -mtime +14 -delete
