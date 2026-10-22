#!/usr/bin/env bash
# Pipeline completo de avaliacao. Uso: make avaliar | tudo | rede | limpar
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="$(cd "$ROOT/.." && pwd)"
GEN="$WS/epcis-arcos-etl-generator"
CC="$ROOT/epcis-fraud-logistic-diversion"
AN="$ROOT/analysis_scripts"
GERAR=0; REDE=0; LIMPAR=0; SIM=0
for a in "$@"; do
  case "$a" in
    --gerar) GERAR=1 ;; --rede) REDE=1 ;; --limpar) LIMPAR=1 ;; --sim) SIM=1 ;;
    *) echo "opcao desconhecida: $a"; exit 2 ;;
  esac
done

if [ "$LIMPAR" = 1 ]; then
  echo "== Arquivos fora do controle de versao (candidatos a limpeza) =="
  for repo in "$ROOT" "$GEN"; do
    echo "-- $repo"
    git -C "$repo" clean -nd -e node_modules -e output -e data | sed 's/^/   /'
  done
  echo "-- datasets intermediarios em $WS/RUN_*/ (mantidos: RUN_2026-09-27_multiscale)"
  ls -d "$WS"/RUN_2026-10-22_fix/d100_e1000_v[0-9]* "$WS"/RUN_2026-10-22_fix/d100_e1000_sub 2>/dev/null | sed 's/^/   /' || true
  if [ "$SIM" = 1 ]; then
    for repo in "$ROOT" "$GEN"; do git -C "$repo" clean -fd -e node_modules -e output -e data; done
    rm -rf "$WS"/RUN_2026-10-22_fix/d100_e1000_v[0-9]* "$WS"/RUN_2026-10-22_fix/d100_e1000_sub
    echo "limpo."
  else
    echo "(nada foi apagado; use --limpar --sim para apagar)"
  fi
  exit 0
fi

command -v node >/dev/null || { echo "erro: node nao encontrado"; exit 1; }
command -v python3 >/dev/null || { echo "erro: python3 nao encontrado"; exit 1; }
[ -d "$CC/node_modules" ] || (cd "$CC" && npm ci --silent)

STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$WS/resultados/$STAMP"
mkdir -p "$OUT"
LOG="$OUT/execucao.log"
exec > >(tee -a "$LOG") 2>&1
echo "Saida em: $OUT"

echo; echo "== 1/5 Testes unitarios das regras =="
(cd "$CC" && npx mocha test/anomalyDetection.test.js) | tee "$OUT/testes.txt" | tail -8

DATA="$GEN/output"
RAW="$(ls "$GEN/data/arcos_raw.gz" "$GEN/data/raw/arcos_raw.gz" 2>/dev/null | head -1)"
if [ "$GERAR" = 1 ] || [ ! -f "$DATA/events.json" ]; then
  echo; echo "== 2/5 Gerando dataset a partir do ARCOS =="
  [ -n "$RAW" ] || { echo "erro: arcos_raw.gz nao encontrado em $GEN/data"; exit 1; }
  (cd "$GEN" && python3 main.py --data "$RAW" --max-lines 1000000 --sample-per-drug 10 \
    --balanced --max-units-per-lot 10 --max-mem-mb 8000 2>&1 | tail -3)
else
  echo; echo "== 2/5 Usando dataset existente em $DATA (use --gerar para regenerar) =="
fi

echo; echo "== 3/5 Preparando subconjuntos =="
SUB="$OUT/dados/d100_e1000"; PREV="$OUT/dados/prevalencia_1pct"
python3 "$AN/subset_dataset.py" "$DATA" "$SUB" 100 10
python3 "$AN/subset_prevalence.py" "$DATA" "$PREV" 0.01 42

echo; echo "== 4/5 Avaliando =="
export NODE_OPTIONS=--max-old-space-size=8192
cd "$CC"
node avaliar_regras.js "$DATA" --json "$OUT/completo.json" > "$OUT/completo.txt"
node avaliar_regras.js "$SUB" --json "$OUT/subset.json" > "$OUT/subset.txt"
node avaliar_regras.js "$PREV" --json "$OUT/prev1.json" > "$OUT/prev1.txt"
tail -3 "$OUT/completo.txt"

echo; echo "== 5/5 Relatorio =="
META="$OUT/meta.json"
python3 - "$META" "$ROOT" "$GEN" "$DATA" <<'PY'
import hashlib, json, subprocess, sys, platform
meta, root, gen, data = sys.argv[1:]
def sh(*c):
    return subprocess.run(c, capture_output=True, text=True).stdout.strip()
h = hashlib.sha256()
with open(data + '/events.json', 'rb') as f:
    for b in iter(lambda: f.read(1 << 20), b''):
        h.update(b)
json.dump({
    'data': sh('date', '+%Y-%m-%d %H:%M'),
    'commit do core (chaincode + avaliador)': sh('git', '-C', root, 'rev-parse', '--short', 'HEAD'),
    'commit do generator': sh('git', '-C', gen, 'rev-parse', '--short', 'HEAD'),
    'sha256 do events.json': h.hexdigest(),
    'semente da amostragem de prevalencia': 42,
    'node': sh('node', '--version'), 'python': platform.python_version(),
    'comando do generator': 'python3 main.py --data data/arcos_raw.gz --max-lines 1000000 --sample-per-drug 10 --balanced --max-units-per-lot 10',
    'reproduzir': 'make tudo',
}, open(meta, 'w'), indent=2, ensure_ascii=False)
PY
python3 "$AN/gerar_relatorio.py" "$OUT/RELATORIO.md" "$META" \
  "Dataset completo=$OUT/completo.json" "Subconjunto 100 medicamentos x 10=$OUT/subset.json" \
  "Prevalencia de anomalias ~1%=$OUT/prev1.json"

if [ "$REDE" = 1 ]; then
  echo; echo "== Rede: teste de carga Caliper (subconjunto 100x10) =="
  docker ps --format '{{.Names}}' | grep -q peer0.org1 || { echo "erro: rede Fabric nao esta no ar (peer0.org1)"; exit 1; }
  (cd "$CC/benchmark" && EPCIS_DATA_DIR="$SUB" ./run-benchmark.sh > "$OUT/caliper.log" 2>&1) || echo "Caliper terminou com erro, ver caliper.log"
  grep -iE "Succ|Fail|Throughput|Avg Latency" "$OUT/caliper.log" | tail -12 | tee "$OUT/caliper_resumo.txt"
fi

echo; echo "Pronto. Leia: $OUT/RELATORIO.md"
