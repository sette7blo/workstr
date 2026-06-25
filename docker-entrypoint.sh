#!/bin/sh
set -e

# /data is a host bind mount and may be owned by an arbitrary host uid. Make it
# writable by the non-root app user, then drop privileges so the server never
# runs as root.
chown -R workstr:workstr /data 2>/dev/null || true

# /app/.env is also a host bind mount, owned by an arbitrary host uid. The
# settings UI writes the token + URLs back to it, so the non-root app user must
# be able to write it or in-app saves fail with EACCES. We must NOT chown it to
# the app user, though: the host `docker compose` CLI also reads .env (env_file
# + ${VAR} interpolation), so it has to stay readable by the host owner. Make it
# read-write for everyone instead, keeping the host owner intact.
chmod 666 /app/.env 2>/dev/null || true

exec su-exec workstr:workstr "$@"
