#!/usr/bin/env bash
# Run Aeyhey locally against a real AI provider.
#
#   bash scripts/run-local.sh          # web and worker together
#   bash scripts/run-local.sh web      # just the web app
#   bash scripts/run-local.sh worker   # just the worker
#
# The API key is read from the environment, never from a file in this repo. Export it in
# your shell profile and it is picked up here. CLAUDE_AEYHO_KEY is checked first so an
# existing Anthropic key in your profile works without renaming anything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ROLE="${1:-both}"
PORT="${PORT:-3000}"

export DATA_DIR="${DATA_DIR:-$ROOT/data}"
export DATABASE_URL="${DATABASE_URL:-file:$DATA_DIR/aeyhey.db}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:$PORT}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
mkdir -p "$DATA_DIR"

# ANTHROPIC_BASE_URL is deliberately cleared. Aeyhey pins the provider URL itself, and an
# ambient value here only ever causes confusion.
unset ANTHROPIC_BASE_URL || true

KEY="${CLAUDE_AEYHO_KEY:-${ANTHROPIC_API_KEY:-}}"
if [ -n "$KEY" ]; then
  export AI_PROVIDER=anthropic
  export ANTHROPIC_API_KEY="$KEY"
  export AI_MODEL_SUMMARY="${AI_MODEL_SUMMARY:-claude-haiku-5-5}"
  export AI_MODEL_GENERATE="${AI_MODEL_GENERATE:-claude-sonnet-5-5}"
  export AI_MODEL_GRADE="${AI_MODEL_GRADE:-claude-haiku-5-5}"
  echo "[aeyhey] using Anthropic: $AI_MODEL_SUMMARY for summaries, $AI_MODEL_GENERATE for questions"
else
  echo "[aeyhey] no API key found, so AI features are off."
  echo "[aeyhey] export CLAUDE_AEYHO_KEY or ANTHROPIC_API_KEY to turn them on."
fi

echo "[aeyhey] data dir: $DATA_DIR"
echo "[aeyhey] running migrations"
pnpm --filter @aeyhey/core exec tsx src/db/cli-migrate.ts

start_web() {
  echo "[aeyhey] web on $PUBLIC_URL"
  pnpm --filter @aeyhey/web exec next dev --port "$PORT"
}

start_worker() {
  echo "[aeyhey] worker starting"
  pnpm --filter @aeyhey/web exec tsx worker.ts
}

case "$ROLE" in
  web) start_web ;;
  worker) start_worker ;;
  both)
    start_worker &
    WORKER_PID=$!
    trap 'kill $WORKER_PID 2>/dev/null || true' EXIT INT TERM
    start_web
    ;;
  *) echo "usage: run-local.sh [web|worker|both]" >&2; exit 1 ;;
esac
