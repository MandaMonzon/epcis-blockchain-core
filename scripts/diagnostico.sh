#!/usr/bin/env bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="$(cd "$ROOT/.." && pwd)"
echo "== Maquina: $(hostname) | $(date '+%Y-%m-%d %H:%M')"
echo "== Versoes: node $(node --version 2>&1) | python $(python3 --version 2>&1) | docker $(docker --version 2>&1 | cut -d, -f1)"
echo "== Disco: $(df -h "$WS" | awk 'NR==2{print $4" livres ("$5" usado)"}')"
for r in "$ROOT" "$WS/epcis-arcos-etl-generator"; do
  echo "== Git $(basename "$r"): $(git -C "$r" rev-parse --short HEAD) | branch: $(git -C "$r" rev-parse --abbrev-ref HEAD)"
  git -C "$r" status --short | head -8 | sed 's/^/   /'
done
echo "== Rede Fabric (containers):"
docker ps --format '   {{.Names}}  {{.Status}}' 2>&1 | grep -E "peer|orderer|logistic" | head -10 || true
[ -z "$(docker ps -q 2>/dev/null)" ] && echo "   (nenhum container no ar)"
echo "== Dados:"
ls -d "$WS"/epcis-arcos-etl-generator/output/events.json "$WS"/epcis-arcos-etl-generator/data/raw/arcos_raw.gz 2>&1 | sed 's/^/   /'
echo "== Resultados anteriores:"
ls -t "$WS"/resultados 2>/dev/null | head -5 | sed 's/^/   /'
echo "== Pastas na raiz do workspace:"
ls "$WS" | sed 's/^/   /'
