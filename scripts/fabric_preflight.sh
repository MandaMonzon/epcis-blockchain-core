#!/usr/bin/env bash
# Checks that the Fabric test-network can start and repairs what it safely can.
# Only additive actions: docker pull / docker tag / docker build of our own Caliper image.
# Never prunes, never touches containers or images it did not create.
set -uo pipefail

FABRIC_NET="${FABRIC_NET:-$HOME/fabric-samples/test-network}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIN_FREE_GB="${MIN_FREE_GB:-10}"
CALIPER_IMAGE="${CALIPER_IMAGE:-caliper-fabric-bound:0.6.0}"
PORTS="${FABRIC_PORTS:-7050 7051 9051 7054 8054 9054}"
problems=0

ok()   { echo "ok:   $*"; }
fixed(){ echo "fixed: $*"; }
bad()  { echo "BAD:  $*"; problems=$((problems + 1)); }

command -v docker > /dev/null || { bad "docker not installed"; exit 1; }
docker info > /dev/null 2>&1 && ok "docker daemon reachable" || { bad "docker daemon not reachable for $USER"; exit 1; }

free_gb=$(df -Pk "$HOME" | awk 'NR==2 {print int($4/1024/1024)}')
[ "$free_gb" -ge "$MIN_FREE_GB" ] && ok "free disk ${free_gb} GB" || bad "free disk ${free_gb} GB < ${MIN_FREE_GB} GB"

FABRIC_ROOT="$(dirname "$FABRIC_NET")"
PEER="$FABRIC_ROOT/bin/peer"
if [ -x "$PEER" ] && [ -x "$FABRIC_ROOT/bin/configtxgen" ]; then
  VERSION=$("$PEER" version 2>/dev/null | awk '/Version:/ {print $2; exit}')
  ok "fabric binaries, version ${VERSION:-unknown}"
else
  bad "fabric binaries missing in $FABRIC_ROOT/bin"
  VERSION=""
fi

# network.sh starts images tagged "latest" unless IMAGETAG is set
IMAGETAG="${IMAGETAG:-latest}"
for img in peer orderer tools ccenv baseos; do
  ref="hyperledger/fabric-$img"
  if docker image inspect "$ref:$IMAGETAG" > /dev/null 2>&1; then
    ok "image $ref:$IMAGETAG"
  elif [ -n "$VERSION" ] && docker pull -q "$ref:$VERSION" > /dev/null 2>&1 && docker tag "$ref:$VERSION" "$ref:$IMAGETAG"; then
    fixed "pulled $ref:$VERSION and tagged $IMAGETAG"
  else
    bad "image $ref:$IMAGETAG missing and could not be pulled"
  fi
done

if docker image inspect "hyperledger/fabric-ca:$IMAGETAG" > /dev/null 2>&1; then
  ok "image hyperledger/fabric-ca:$IMAGETAG"
else
  CA_VERSION=$(docker images --format '{{.Tag}}' hyperledger/fabric-ca 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1)
  CA_VERSION="${CA_VERSION:-1.5.7}"
  if docker pull -q "hyperledger/fabric-ca:$CA_VERSION" > /dev/null 2>&1 && docker tag "hyperledger/fabric-ca:$CA_VERSION" "hyperledger/fabric-ca:$IMAGETAG"; then
    fixed "pulled hyperledger/fabric-ca:$CA_VERSION and tagged $IMAGETAG"
  else
    bad "image hyperledger/fabric-ca:$IMAGETAG missing and could not be pulled"
  fi
fi

if docker image inspect "$CALIPER_IMAGE" > /dev/null 2>&1; then
  ok "image $CALIPER_IMAGE"
elif [ -f "$REPO/epcis-fraud-logistic-diversion/benchmark/Dockerfile.caliper" ]; then
  if docker build -q -t "$CALIPER_IMAGE" -f "$REPO/epcis-fraud-logistic-diversion/benchmark/Dockerfile.caliper" "$REPO/epcis-fraud-logistic-diversion/benchmark" > /dev/null 2>&1; then
    fixed "built $CALIPER_IMAGE"
  else
    bad "could not build $CALIPER_IMAGE (benchmark will not run)"
  fi
else
  bad "no Dockerfile.caliper to build $CALIPER_IMAGE"
fi

# ports held by something other than a Fabric container are not ours to free
for port in $PORTS; do
  owner=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "[:>]$port->|:$port->" | awk '{print $1}' | head -1)
  if (echo > "/dev/tcp/127.0.0.1/$port") 2> /dev/null; then
    if echo "$owner" | grep -qE '^(peer0|orderer|ca_)'; then ok "port $port held by our Fabric container $owner (network.sh down frees it)"
    else bad "port $port is used by ${owner:-a non-docker process}"; fi
  else
    ok "port $port free"
  fi
done

[ "$problems" -eq 0 ] && echo "preflight: all good" || echo "preflight: $problems problem(s)"
exit $(( problems > 0 ))
