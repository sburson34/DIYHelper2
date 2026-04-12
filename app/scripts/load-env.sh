#!/usr/bin/env bash
# Loads .env.local and injects EXPO_PUBLIC_GIT_COMMIT from the current HEAD.
# Used by npm scripts so you never have to remember to source anything.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

export EXPO_PUBLIC_GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

exec "$@"
