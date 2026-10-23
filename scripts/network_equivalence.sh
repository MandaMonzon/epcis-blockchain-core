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

(cd "$FABRIC_NET" && ./network.sh down && ./network.sh up createChannel -ca \
  && ./network.sh deployCC -ccn "$CHAINCODE_NAME" -ccp "$REPO/epcis-fraud-logistic-diversion/chaincode" -ccl javascript)

FABRIC_NET="$FABRIC_NET" CHAINCODE_NAME="$CHAINCODE_NAME" node validation/network_equivalence.js submit "$WORK/subset.json" "$WORK/network.json"
node validation/network_equivalence.js compare "$WORK/local.json" "$WORK/network.json"
make validate VALIDATE_ARGS="--network-results $WORK/network.json"
