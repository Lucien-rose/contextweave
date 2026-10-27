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
model_settings="$work/connections.json"
network_family="${CW_BENCHMARK_NETWORK_FAMILY:-ipv4}"
report_base="/root/contextweave-provider-benchmark-$stamp"
if [[ ! "$network_family" =~ ^(auto|ipv4|ipv6)$ ]]; then
  echo "CW_BENCHMARK_NETWORK_FAMILY must be auto, ipv4 or ipv6." >&2
  exit 1
fi
cleanup_collection() {
  (cd "$repo" && \
    MOSS_VECTOR_ENV_FILE="$vector_env" \
    MOSS_MODEL_SETTINGS_FILE="$model_settings" \
    MOSS_MODEL_KEY_FILE=/etc/moss-memory/models.key \
    MOSS_MODELS_NETWORK_FAMILY="$network_family" \
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

# The long-running service may have a working IPv4 preference that a one-off
# root shell does not inherit. Keep production settings immutable: use a
# benchmark-only copy and replace only missing/automatic network selection.
install -m 600 /etc/moss-memory/models/connections.json "$model_settings"
node --input-type=module - "$model_settings" "$network_family" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [path, family] = process.argv.slice(2);
const state = JSON.parse(readFileSync(path, 'utf8'));
for (const connection of Object.values(state.connections || {})) {
  if (!connection.network_family || connection.network_family === 'auto') connection.network_family = family;
}
writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
NODE

cd "$repo"
npm ci --ignore-scripts
MOSS_VECTOR_ENV_FILE="$vector_env" \
MOSS_RECALL_PROFILE_FILE="$repo/evaluation/product-recall-profile.json" \
MOSS_MODEL_SETTINGS_FILE="$model_settings" \
MOSS_MODEL_KEY_FILE=/etc/moss-memory/models.key \
MOSS_MODELS_NETWORK_FAMILY="$network_family" \
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
echo "MODEL_NETWORK_FAMILY=$network_family"
echo
echo "----- REPORT -----"
cat "$report_base.md"
