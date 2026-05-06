#!/bin/sh
# vm-backup-db.sh — backup nightly del DB Postgres dello stack di prod.
#
# Va eseguito SULLA VM, schedulato da cron. Fa pg_dump dentro il container
# pcm_db, scrive il file in $BACKUPS_DIR e tiene solo gli ultimi $KEEP dump
# (default 3, per non riempire gli 8 GB della VM).
#
# Esempio crontab (alle 3:00 ogni notte):
#   0 3 * * * /opt/pcm-hub/script/vm-backup-db.sh >> /opt/pcm-hub/backups/cron.log 2>&1
#
# Variabili attese (esportate dal cron o messe inline qui sopra il chiama-
# mento, NON committate):
#   POSTGRES_USER  - utente DB (deve coincidere con la var dello stack)
#   POSTGRES_DB    - nome DB
#
# Override opzionali:
#   PROJECT_DIR    - cartella con docker-compose.prod.yml (default: /opt/pcm-hub)
#   BACKUPS_DIR    - dove salvare i dump (default: $PROJECT_DIR/backups)
#   KEEP           - quanti dump tenere (default: 3)
#   COMPOSE_FILE   - nome del compose (default: docker-compose.prod.yml)

set -eu

PROJECT_DIR="${PROJECT_DIR:-/opt/pcm-hub}"
BACKUPS_DIR="${BACKUPS_DIR:-$PROJECT_DIR/backups}"
KEEP="${KEEP:-3}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_DB:-}" ]; then
  echo "[backup] ERROR: POSTGRES_USER e POSTGRES_DB non impostate." >&2
  exit 1
fi

mkdir -p "$BACKUPS_DIR"
cd "$PROJECT_DIR"

TS=$(date +%Y%m%d-%H%M)
OUT="$BACKUPS_DIR/db-$TS.dump"

echo "[backup] $(date -Iseconds) start -> $OUT"

# pg_dump in formato custom (-F c): compresso, ripristinabile con pg_restore.
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" -F c "$POSTGRES_DB" > "$OUT"

# Verifica che il file non sia vuoto: se pg_dump fallisce, redirige solo
# l'errore e il file di output finisce a 0 byte.
if [ ! -s "$OUT" ]; then
  echo "[backup] ERROR: dump vuoto, qualcosa e' andato storto. Cancello $OUT." >&2
  rm -f "$OUT"
  exit 2
fi

SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
echo "[backup] dump ok, $SIZE bytes"

# Rotation: tiene solo gli ultimi $KEEP file, in ordine di nome
# (i nomi includono il timestamp YYYYMMDD-HHMM, quindi sort-friendly).
cd "$BACKUPS_DIR"
ls -1t db-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "[backup] rotation: rimuovo $old"
  rm -f -- "$old"
done

echo "[backup] $(date -Iseconds) done. Dump locali tenuti: $KEEP"
