#!/bin/sh
# vm-backup-db.sh — backup nightly del DB Postgres dello stack di prod.
#
# Va eseguito SULLA VM, schedulato da cron. Fa pg_dump dentro il container
# pcm_db (target by name, NON dipende dal path del compose: funziona sia
# con Portainer Repository mode sia con compose locale).
# Scrive il file in $BACKUPS_DIR e tiene solo gli ultimi $KEEP dump
# (default 3, per non riempire gli 8 GB della VM).
#
# Setup tipico:
#   sudo mkdir -p /opt/pcm-hub
#   sudo cp script/vm-backup-db.sh /opt/pcm-hub/
#   sudo chmod +x /opt/pcm-hub/vm-backup-db.sh
#   sudo chown -R $USER:$USER /opt/pcm-hub
#
# Esempio crontab (alle 3:00 ogni notte):
#   POSTGRES_USER=<user>
#   POSTGRES_DB=<db>
#   0 3 * * * /opt/pcm-hub/vm-backup-db.sh >> /opt/pcm-hub/backups/cron.log 2>&1
#
# Variabili attese (esportate dal cron, vedi sopra):
#   POSTGRES_USER  - utente DB (deve coincidere con la var dello stack)
#   POSTGRES_DB    - nome DB
#
# Override opzionali:
#   BACKUPS_DIR     - dove salvare i dump (default: /opt/pcm-hub/backups)
#   KEEP            - quanti dump tenere (default: 3)
#   DB_CONTAINER    - nome del container DB (default: pcm_db)

set -eu

BACKUPS_DIR="${BACKUPS_DIR:-/opt/pcm-hub/backups}"
KEEP="${KEEP:-3}"
DB_CONTAINER="${DB_CONTAINER:-pcm_db}"

if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_DB:-}" ]; then
  echo "[backup] ERROR: POSTGRES_USER e POSTGRES_DB non impostate." >&2
  exit 1
fi

mkdir -p "$BACKUPS_DIR"

TS=$(date +%Y%m%d-%H%M)
OUT="$BACKUPS_DIR/db-$TS.dump"

echo "[backup] $(date -Iseconds) start -> $OUT"

# pg_dump in formato custom (-F c): compresso, ripristinabile con pg_restore.
docker exec -i "$DB_CONTAINER" \
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
