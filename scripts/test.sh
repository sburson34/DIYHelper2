#!/usr/bin/env bash
# Canonical test command surface for the DIYHelper2 monorepo.
# Usage: bash scripts/test.sh <target>
#
# Targets:
#   all            — everything: lint, fe, be
#   fast           — skips slow smoke (fe) and coverage (be); <2 min target
#   fe             — frontend Jest (all)
#   fe:unit        — frontend unit+logic only (skip nav/smoke)
#   fe:nav         — frontend navigation suites
#   fe:smoke       — frontend screen smoke (slow)
#   fe:coverage    — frontend Jest with coverage report
#   be             — backend xUnit (all)
#   be:unit        — backend unit tests only
#   be:integration — backend integration tests (WebApplicationFactory)
#   be:coverage    — backend xUnit with coverage
#   lint           — frontend ESLint
#   build-verify   — dotnet publish smoke (catches missing content files, etc.)
#   e2e            — Maestro flows (requires running emulator + installed app)
#
# Design notes:
#   - Each target echoes the command it runs before executing, so copy/paste
#     debugging is straightforward.
#   - Non-zero exit from any sub-command fails the whole script (set -e).

set -euo pipefail

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
APP_DIR="$REPO_ROOT/app"
BACKEND_DIR="$REPO_ROOT/backend"

run() { echo "+ $*"; "$@"; }

target="${1:-all}"

case "$target" in
  all)
    bash "$0" lint
    bash "$0" fe
    bash "$0" be
    ;;

  fast)
    # Skip the slow screen-smoke suite and skip coverage. Aim: sub-2-min signal.
    ( cd "$APP_DIR" && run npm run test:fast )
    ( cd "$BACKEND_DIR" && run dotnet test DIYHelper2.slnx --nologo --filter "FullyQualifiedName!~Integration" )
    ;;

  fe)             ( cd "$APP_DIR" && run npm test ) ;;
  fe:unit)        ( cd "$APP_DIR" && run npm run test:unit ) ;;
  fe:nav)         ( cd "$APP_DIR" && run npm run test:nav ) ;;
  fe:smoke)       ( cd "$APP_DIR" && run npm run test:smoke ) ;;
  fe:coverage)    ( cd "$APP_DIR" && run npm run test:coverage ) ;;

  be)             ( cd "$BACKEND_DIR" && run dotnet test DIYHelper2.slnx --nologo ) ;;
  be:unit)
    ( cd "$BACKEND_DIR" && run dotnet test DIYHelper2.slnx --nologo \
        --filter "FullyQualifiedName!~Integration" )
    ;;
  be:integration)
    ( cd "$BACKEND_DIR" && run dotnet test DIYHelper2.slnx --nologo \
        --filter "FullyQualifiedName~Integration" )
    ;;
  be:coverage)
    ( cd "$BACKEND_DIR" && run dotnet test DIYHelper2.slnx --nologo \
        --collect:"XPlat Code Coverage" --results-directory TestResults )
    ;;

  lint)           ( cd "$APP_DIR" && run npm run lint ) ;;

  build-verify)
    ( cd "$BACKEND_DIR/DIYHelper2.Api" && run dotnet publish -c Release -o publish-verify )
    ;;

  e2e)
    # Maestro runs the black-box flows. Requires `maestro` on PATH and a
    # running emulator / connected device with a debug APK installed.
    ( cd "$APP_DIR" && run maestro test maestro/ )
    ;;

  -h|--help|help)
    awk '/^# Targets:/,/^# Design notes:/' "$0" | sed 's/^# \{0,1\}//'
    ;;

  *)
    echo "Unknown target: $target" >&2
    echo "Run: bash scripts/test.sh help" >&2
    exit 1
    ;;
esac
