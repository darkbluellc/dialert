#!/usr/bin/env bash
#
# Build the DiALERT image, push it to GHCR, and trigger a Coolify deploy.
#
# Prerequisite: you must already be logged in to GHCR. This is a one-time step:
#
#   echo "$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin
#
# where GHCR_PAT is a GitHub personal access token with the write:packages
# scope. The login is cached by Docker, so this script does not handle it.
#
# Secrets live ONLY in scripts/deploy.env (gitignored), next to this script.
# Copy scripts/deploy.env.example to scripts/deploy.env and fill it in first.
#
#   ./scripts/deploy.sh            # build + push + deploy
#   ./scripts/deploy.sh --no-deploy   # build + push only
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_FILE="$SCRIPT_DIR/deploy.env"
IMAGE="ghcr.io/darkbluellc/dialert"
PLATFORM="${PLATFORM:-linux/amd64}"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "ERROR: $SECRETS_FILE not found. Copy scripts/deploy.env.example to scripts/deploy.env and fill it in." >&2
  exit 1
fi

# Load deploy secrets (COOLIFY_URL, COOLIFY_TOKEN, COOLIFY_UUID).
set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

# Tag with the current git short SHA (fallback to a timestamp) plus :latest.
TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"

# Assumes you are already logged in to GHCR (see the header comment). The push
# below will fail with an auth error if not.
echo "==> Building $IMAGE:$TAG ($PLATFORM)"
docker buildx build \
  --platform "$PLATFORM" \
  -t "$IMAGE:$TAG" \
  -t "$IMAGE:latest" \
  --push \
  "$REPO_ROOT"

echo "==> Pushed $IMAGE:$TAG and $IMAGE:latest"

if [[ "${1:-}" == "--no-deploy" ]]; then
  echo "==> --no-deploy set; skipping Coolify trigger."
  exit 0
fi

: "${COOLIFY_URL:?Set COOLIFY_URL in scripts/deploy.env}"
: "${COOLIFY_TOKEN:?Set COOLIFY_TOKEN in scripts/deploy.env}"
: "${COOLIFY_UUID:?Set COOLIFY_UUID in scripts/deploy.env}"

echo "==> Triggering Coolify deploy for $COOLIFY_UUID"
HTTP_CODE="$(curl -sS -o /tmp/dialert_deploy_resp.json -w "%{http_code}" \
  -X GET "${COOLIFY_URL%/}/api/v1/deploy?uuid=${COOLIFY_UUID}&force=false" \
  -H "Authorization: Bearer ${COOLIFY_TOKEN}")"

echo "Coolify response ($HTTP_CODE):"
cat /tmp/dialert_deploy_resp.json && echo
rm -f /tmp/dialert_deploy_resp.json

if [[ "$HTTP_CODE" -ge 400 ]]; then
  echo "ERROR: Coolify deploy trigger failed (HTTP $HTTP_CODE)." >&2
  exit 1
fi

echo "==> Deploy triggered."
