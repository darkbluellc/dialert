#!/bin/sh
# Container entrypoint. Applies pending Prisma migrations before starting
# whatever command was passed (web server or worker), so the database is
# initialized regardless of how the image is launched (Coolify image deploy,
# docker compose, plain `docker run`, etc.).
#
# Set RUN_MIGRATIONS=false to skip — used by the worker service so migrations
# run in exactly one place and two containers don't race on startup.
set -e

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  echo "==> Applying database migrations (prisma migrate deploy)..."
  npx prisma migrate deploy
fi

exec "$@"
