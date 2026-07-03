#!/bin/sh
# Container entrypoint. Applies pending Prisma migrations, optionally starts the
# background polling scheduler, then execs the given command (web server or
# worker). This keeps a single container self-sufficient regardless of how the
# image is launched (Coolify image deploy, docker compose, plain `docker run`).
#
#   RUN_MIGRATIONS=false  skip `prisma migrate deploy`
#   RUN_SCHEDULER=false   skip the background poller (e.g. running it separately)
set -e

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  echo "==> Applying database migrations (prisma migrate deploy)..."
  npx prisma migrate deploy
fi

# Start the poller in the background for the web server. If the command IS the
# worker, don't spawn a second one.
if [ "${RUN_SCHEDULER:-true}" != "false" ]; then
  case "$*" in
    *worker*) : ;;
    *)
      echo "==> Starting background scheduler..."
      npm run worker &
      ;;
  esac
fi

exec "$@"
