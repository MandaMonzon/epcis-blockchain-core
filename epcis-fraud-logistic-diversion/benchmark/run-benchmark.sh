#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

FABRIC_NET="/home/monzonamanda/fabric-samples/test-network"
ORG1_KEYSTORE="$FABRIC_NET/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore"
CALIPER_IMAGE="caliper-fabric-bound:0.6.0"

sudo chmod -R a+rX "$FABRIC_NET/organizations/peerOrganizations/" 2>/dev/null || true

KEY_FILE=$(ls ${ORG1_KEYSTORE}/*_sk 2>/dev/null | head -n 1 | xargs basename)

if [ -z "$KEY_FILE" ]; then
    echo "Erro: Nenhuma chave privada (*_sk) encontrada em $ORG1_KEYSTORE"
    exit 1
fi

echo "✓ Fabric network: $FABRIC_NET"
echo "✓ Private key ativa: $KEY_FILE"

cp "$SCRIPT_DIR/network.yaml" "$SCRIPT_DIR/network.yaml.bak"
sed -i -E "s/[a-f0-9]{64}_sk/$KEY_FILE/g" "$SCRIPT_DIR/network.yaml"
trap 'mv "$SCRIPT_DIR/network.yaml.bak" "$SCRIPT_DIR/network.yaml" 2>/dev/null || true' EXIT

if ! docker image inspect "$CALIPER_IMAGE" >/dev/null 2>&1; then
    echo "▶ Construindo a imagem $CALIPER_IMAGE..."
    docker build -t "$CALIPER_IMAGE" -f "$SCRIPT_DIR/Dockerfile.caliper" "$SCRIPT_DIR"
fi

echo "▶ Executando o benchmark Caliper..."

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$PROJECT_ROOT:/blockchain-research" \
  -v "$(dirname "$FABRIC_NET"):/blockchain-research/fabric-samples" \
  -v "$SCRIPT_DIR:/caliper-workspace" \
  -w /caliper-workspace \
  "$CALIPER_IMAGE" \
  launch manager \
    --caliper-workspace /caliper-workspace \
    --caliper-benchconfig config.yaml \
    --caliper-networkconfig network.yaml \
    --caliper-fabric-gateway-enabled
