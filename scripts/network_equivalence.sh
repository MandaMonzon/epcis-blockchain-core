#!/usr/bin/env bash
# Item 19: score the same transactions through the Fabric network and the local evaluator.
# Wipes the test-network ledger: refuses to run unless CONFIRM_WIPE=yes.
# Usage: CONFIRM_WIPE=yes scripts/network_equivalence.sh <dataset dir>
set -euo pipefail

DATASET="${1:?usage: scripts/network_equivalence.sh <dataset dir>}"
FABRIC_NET="${FABRIC_NET:-$HOME/fabric-samples/test-network}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$REPO/validation/work}"
CHAINCODE_NAME="${CHAINCODE_NAME:-logistic-diversion}"

[ "${CONFIRM_WIPE:-}" = yes ] || { echo "refusing: this wipes the ledger of $FABRIC_NET. Set CONFIRM_WIPE=yes after checking nobody is using the network."; exit 1; }

mkdir -p "$WORK"
cd "$REPO"
node validation/network_equivalence.js prepare "$DATASET" "$WORK/subset.json"
node validation/network_equivalence.js local "$WORK/subset.json" "$WORK/local.json"

"$REPO/scripts/fabric_preflight.sh"

diagnostics() {
  echo "--- diagnostics ($1) ---"
  docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -E 'peer|orderer|ca_|dev-' || true
  for c in $(docker ps -a --format '{{.Names}}' | grep -E '^(peer0|orderer|ca_)' || true); do
    echo "## $c"; docker logs --tail 15 "$c" 2>&1 || true
  done
}

fresh_network() {
  ./network.sh down && ./network.sh up createChannel -ca \
    && ./network.sh deployCC -ccn "$CHAINCODE_NAME" -ccp "$REPO/epcis-fraud-logistic-diversion/chaincode" -ccl javascript
}

for n in 1 2 3; do
  echo "== network up + deployCC: attempt $n/3"
  if (cd "$FABRIC_NET" && fresh_network); then break; fi
  diagnostics "attempt $n"
  (cd "$FABRIC_NET" && ./network.sh down) || true
  [ "$n" -eq 3 ] && { echo "FAILED after 3 attempts"; exit 1; }
  sleep $((n * 30))
  "$REPO/scripts/fabric_preflight.sh" || true
done

FABRIC_NET="$FABRIC_NET" CHAINCODE_NAME="$CHAINCODE_NAME" node validation/network_equivalence.js submit "$WORK/subset.json" "$WORK/network.json"
node validation/network_equivalence.js compare "$WORK/local.json" "$WORK/network.json"
make validate VALIDATE_ARGS="--network-results $WORK/network.json --report $WORK/REPORT_network.md"

if [ "${RUN_CALIPER_SMOKE:-no}" = yes ]; then
  "$REPO/scripts/caliper_smoke.sh" "$DATASET"
fi
