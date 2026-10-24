#!/bin/sh
# Starts as root only to fix ownership of the data folder (e.g. Synology bind mounts
# or files copied from the old version), then runs the app as the unprivileged "node" user.
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if [ -n "$(find "$DATA_DIR" ! -user node -print -quit 2>/dev/null)" ]; then
    chown -R node:node "$DATA_DIR"
  fi
  exec su-exec node "$@"
fi
exec "$@"
