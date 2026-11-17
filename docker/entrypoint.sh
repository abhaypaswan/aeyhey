#!/bin/sh
# Aeyhey container entrypoint. Runs migrations once, seeds the demo if asked, then starts
# web or worker.
#
# Both roles run their entry point through tsx: @aeyhey/core ships TypeScript source, and
# the worker is not part of the Next.js build output.
set -e

ROLE="${1:-web}"
TSX="node_modules/.bin/tsx"

if [ "$ROLE" = "web" ]; then
  echo "[aeyhey] running migrations"
  "$TSX" apps/web/migrate.ts

  if [ "${DEMO_MODE:-false}" = "true" ]; then
    # Without this the demo starts empty, which is the one thing a demo must not do.
    # It is idempotent, so a restart does not double the data.
    echo "[aeyhey] seeding demo data"
    "$TSX" packages/core/src/seed/cli-seed.ts || echo "[aeyhey] demo seeding skipped"
  fi

  echo "[aeyhey] starting web on port ${PORT:-3000}"
  exec node apps/web/server.js
fi

if [ "$ROLE" = "worker" ]; then
  # The web service runs the migrations, so give it a moment to finish them.
  echo "[aeyhey] waiting for migrations"
  sleep 3
  echo "[aeyhey] starting worker"
  exec "$TSX" apps/web/worker.ts
fi

echo "[aeyhey] unknown role: $ROLE (expected web or worker)" >&2
exit 1
