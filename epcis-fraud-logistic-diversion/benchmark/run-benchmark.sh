#!/usr/bin/env bash
# run-benchmark.sh — runs the Caliper benchmark on any machine
#
# Prerequisites:
#   - Docker running
#   - Hyperledger Fabric test-network up: ./network.sh up createChannel -c mychannel -ca
#   - fabric-samples in one of the default locations OR set FABRIC_NETWORK env var
#
# Usage:
#   ./run-benchmark.sh
#   FABRIC_NETWORK=/custom/path/fabric-samples/test-network ./run-benchmark.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Locate fabric-samples/test-network ────────────────────────────────────────
if [ -n "$FABRIC_NETWORK" ]; then
  FABRIC_NET="$FABRIC_NETWORK"
else
  # Search common install locations
  for candidate in \
    "$SCRIPT_DIR/../../../../fabric-samples/test-network" \
    "$HOME/fabric-samples/test-network" \
    "$HOME/go/src/github.com/hyperledger/fabric-samples/test-network"
  do
    if [ -d "$candidate/organizations" ]; then
      FABRIC_NET="$(cd "$candidate" && pwd)"
      break
    fi
  done
fi

if [ -z "$FABRIC_NET" ] || [ ! -d "$FABRIC_NET/organizations" ]; then
  echo "✗ fabric-samples/test-network not found."
  echo "  Set FABRIC_NETWORK=/path/to/fabric-samples/test-network or install fabric-samples."
  exit 1
fi
echo "✓ Fabric network: $FABRIC_NET"

# ── Locate caliper Docker image ────────────────────────────────────────────────
CALIPER_IMAGE="caliper-fabric-bound:0.6.0"
if ! docker image inspect "$CALIPER_IMAGE" >/dev/null 2>&1; then
  echo "Building Caliper image (first time, takes ~2 min)..."
  docker build -t "$CALIPER_IMAGE" -f "$SCRIPT_DIR/Dockerfile.caliper" "$SCRIPT_DIR"
fi

# ── Read dynamic keystore SK filename ─────────────────────────────────────────
KEYSTORE_DIR="$FABRIC_NET/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore"
SK_FILE=$(ls "$KEYSTORE_DIR"/*_sk 2>/dev/null | head -1 | xargs basename 2>/dev/null)
if [ -z "$SK_FILE" ]; then
  echo "✗ Private key not found in $KEYSTORE_DIR"
  echo "  Did you run: ./network.sh up createChannel -c mychannel -ca ?"
  exit 1
fi
echo "✓ Private key: $SK_FILE"

# ── Generate connection-org1-docker.yaml from local TLS certs ─────────────────
PEER_TLS="$FABRIC_NET/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
CA_TLS="$FABRIC_NET/organizations/peerOrganizations/org1.example.com/ca/ca.org1.example.com-cert.pem"

PEER_PEM=$(awk '{print "          " $0}' "$PEER_TLS")
CA_PEM=$(awk '{print "          " $0}' "$CA_TLS")

cat > "$SCRIPT_DIR/connection-org1-docker.yaml" << YAML
---
name: test-network-org1
version: 1.0.0
client:
  organization: Org1
  connection:
    timeout:
      peer:
        endorser: '300'
organizations:
  Org1:
    mspid: Org1MSP
    peers:
    - peer0.org1.example.com
    certificateAuthorities:
    - ca.org1.example.com
peers:
  peer0.org1.example.com:
    url: grpcs://host.docker.internal:7051
    tlsCACerts:
      pem: |
$PEER_PEM
    grpcOptions:
      ssl-target-name-override: peer0.org1.example.com
      hostnameOverride: peer0.org1.example.com
certificateAuthorities:
  ca.org1.example.com:
    url: https://host.docker.internal:7054
    caName: ca-org1
    tlsCACerts:
      pem:
        - |
$CA_PEM
    httpOptions:
      verify: false
YAML
echo "✓ connection-org1-docker.yaml generated"

# ── Update keystore SK in network.yaml ─────────────────────────────────────────
sed -i.bak "s|keystore/.*_sk\|keystore/KEYSTORE_SK|keystore/$SK_FILE|g" "$SCRIPT_DIR/network.yaml"
echo "✓ network.yaml updated"

# ── Run Caliper ────────────────────────────────────────────────────────────────
# Detect project root (folder containing epcis-blockchain-core)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
EPCIS_OUTPUT="${EPCIS_OUTPUT:-/epcis-output}"

echo ""
echo "▶ Running Caliper benchmark..."
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$PROJECT_ROOT:/blockchain-research" \
  -v "$SCRIPT_DIR:/caliper-workspace" \
  -w /caliper-workspace \
  "$CALIPER_IMAGE" \
  launch manager \
    --caliper-workspace /caliper-workspace \
    --caliper-benchconfig config.yaml \
    --caliper-networkconfig network.yaml

# Restore network.yaml placeholder
mv "$SCRIPT_DIR/network.yaml.bak" "$SCRIPT_DIR/network.yaml"
echo "✓ Done — report: $SCRIPT_DIR/report.html"
