#!/bin/sh
# Starts as root only to fix ownership of the data folder (e.g. Synology bind mounts
# or files copied from the old version), then runs the app as the unprivileged "node" user.
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
if [ "$(id -u)" = "0" ]; then
  for d in "$DATA_DIR" "$BACKUP_DIR"; do
    mkdir -p "$d"
    if [ -n "$(find "$d" ! -user node -print -quit 2>/dev/null)" ]; then
      chown -R node:node "$d"
    fi
  done
  exec su-exec node "$@"
fi
exec "$@"
