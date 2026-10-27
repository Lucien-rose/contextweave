#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root so the existing encrypted model routes can be read." >&2
  exit 1
fi
if [[ ! -r /etc/moss-memory/vector.env ]]; then
  echo "Missing /etc/moss-memory/vector.env" >&2
  exit 1
fi
if [[ ! -r /etc/moss-memory/models/connections.json || ! -r /etc/moss-memory/models.key ]]; then
  echo "Missing encrypted model connection files." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d /tmp/cw-product-benchmark.XXXXXX)"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vector_env="$work/vector.env"
report_base="/root/contextweave-provider-benchmark-$stamp"
cleanup_collection() {
  (cd "$repo" && \
    MOSS_VECTOR_ENV_FILE="$vector_env" \
    MOSS_MODEL_SETTINGS_FILE=/etc/moss-memory/models/connections.json \
    MOSS_MODEL_KEY_FILE=/etc/moss-memory/models.key \
    node scripts/cleanup-product-benchmark.js)
}
cleanup() {
  if [[ -f "$vector_env" ]]; then
    cleanup_collection >/dev/null 2>&1 || true
  fi
  if [[ "$work" == /tmp/cw-product-benchmark.* && -d "$work" ]]; then
    rm -rf -- "$work"
  fi
}
trap cleanup EXIT

awk -v prefix="cw_eval_${stamp,,}" '
  BEGIN { replaced=0 }
  /^MOSS_QDRANT_COLLECTION_PREFIX=/ { print "MOSS_QDRANT_COLLECTION_PREFIX=" prefix; replaced=1; next }
  /^MOSS_RECALL_VECTOR_MODE=/ { print "MOSS_RECALL_VECTOR_MODE=on"; vector=1; next }
  { print }
  END {
    if (!replaced) print "MOSS_QDRANT_COLLECTION_PREFIX=" prefix
    if (!vector) print "MOSS_RECALL_VECTOR_MODE=on"
  }
' /etc/moss-memory/vector.env > "$vector_env"
chmod 600 "$vector_env"

cd "$repo"
npm ci --ignore-scripts
MOSS_VECTOR_ENV_FILE="$vector_env" \
MOSS_RECALL_PROFILE_FILE="$repo/evaluation/product-recall-profile.json" \
MOSS_MODEL_SETTINGS_FILE=/etc/moss-memory/models/connections.json \
MOSS_MODEL_KEY_FILE=/etc/moss-memory/models.key \
MOSS_JEV_ENV_FILE=/etc/moss-memory/jev.env \
CW_BENCHMARK_REAL_PROVIDERS=1 \
node scripts/evaluate-product-effect.js

install -m 600 evaluation/results/product-core.md "$report_base.md"
install -m 600 evaluation/results/product-core.json "$report_base.json"
cleanup_result="$(cleanup_collection)"
trap - EXIT
if [[ "$work" == /tmp/cw-product-benchmark.* ]]; then
  rm -rf -- "$work"
fi
echo
echo "REPORT_MD=$report_base.md"
echo "REPORT_JSON=$report_base.json"
echo "CLEANUP=$cleanup_result"
echo
echo "----- REPORT -----"
cat "$report_base.md"
