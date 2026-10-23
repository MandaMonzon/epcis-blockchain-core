#!/usr/bin/env bash
# Proves the Caliper benchmark works against the running network: 5 transactions per round.
# Usage: scripts/caliper_smoke.sh <dataset dir containing events.json>
set -euo pipefail

DATASET="$(cd "${1:?usage: scripts/caliper_smoke.sh <dataset dir>}" && pwd)"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BENCH="$REPO/epcis-fraud-logistic-diversion/benchmark"
export FABRIC_NET="${FABRIC_NET:-$HOME/fabric-samples/test-network}"

sed -e 's/__OBJ_TX__/5/' -e 's/__AGG_TX__/5/' -e 's/__TXN_TX__/5/' "$BENCH/config.template.yaml" > "$BENCH/config.smoke.yaml"
trap 'rm -f "$BENCH/config.smoke.yaml"' EXIT

out=$(EPCIS_DATA_DIR="$DATASET" BENCH_CONFIG=config.smoke.yaml bash "$BENCH/run-benchmark.sh" 2>&1) || { echo "$out" | tail -40; echo "caliper smoke: FAIL (run exited non-zero)"; exit 1; }
echo "$out" | tail -25

rounds=$(echo "$out" | awk -F'|' '/\| *submit/ {n++; gsub(/ /,"",$3); gsub(/ /,"",$4); if ($3 + 0 < 1 || $4 + 0 > 0) bad++} END {print n+0, bad+0}')
set -- $rounds
if [ "$1" -ge 3 ] && [ "$2" -eq 0 ]; then
  echo "caliper smoke: PASS ($1 rounds, all transactions succeeded)"
else
  echo "caliper smoke: FAIL ($1 rounds reported, $2 with failures or no successes)"; exit 1
fi
