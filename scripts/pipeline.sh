#!/usr/bin/env bash
# Full evaluation pipeline. Usage: make evaluate | all | network | clean
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="$(cd "$ROOT/.." && pwd)"
GEN="$WS/epcis-arcos-etl-generator"
CC="$ROOT/epcis-fraud-logistic-diversion"
AN="$ROOT/analysis_scripts"
REGENERATE=0; NETWORK=0; CLEAN=0; CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    --regenerate) REGENERATE=1 ;;
    --network) NETWORK=1 ;;
    --clean) CLEAN=1 ;;
    --yes) CONFIRM=1 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done

if [ "$CLEAN" = 1 ]; then
  echo "== Untracked files (cleanup candidates) =="
  for repo in "$ROOT" "$GEN"; do
    echo "-- $repo"
    git -C "$repo" clean -nd -e node_modules -e output -e data | sed 's/^/   /'
  done
  echo "-- intermediate datasets in $WS/RUN_2026-10-22_fix"
  ls -d "$WS"/RUN_2026-10-22_fix/d100_e1000_v[0-9]* "$WS"/RUN_2026-10-22_fix/d100_e1000_sub 2>/dev/null | sed 's/^/   /' || true
  if [ "$CONFIRM" = 1 ]; then
    for repo in "$ROOT" "$GEN"; do git -C "$repo" clean -fd -e node_modules -e output -e data; done
    rm -rf "$WS"/RUN_2026-10-22_fix/d100_e1000_v[0-9]* "$WS"/RUN_2026-10-22_fix/d100_e1000_sub
    echo "cleaned."
  else
    echo "(nothing deleted; run 'make clean-yes' to delete)"
  fi
  exit 0
fi

command -v node >/dev/null || { echo "error: node not found"; exit 1; }
command -v python3 >/dev/null || { echo "error: python3 not found"; exit 1; }
[ -d "$CC/node_modules" ] || (cd "$CC" && npm ci --silent)

OUT="$WS/results/$(date +%Y-%m-%d_%H%M)"
mkdir -p "$OUT"
exec > >(tee -a "$OUT/run.log") 2>&1
echo "Output: $OUT"

echo; echo "== 1/5 Unit tests =="
(cd "$CC" && npx mocha test/anomalyDetection.test.js) | tee "$OUT/tests.txt" | tail -8

DATA="$GEN/output"
RAW=""
for f in "$GEN/data/arcos_raw.gz" "$GEN/data/raw/arcos_raw.gz"; do [ -z "$RAW" ] && [ -f "$f" ] && RAW="$f"; done
if [ "$REGENERATE" = 1 ] || [ ! -f "$DATA/events.json" ]; then
  echo; echo "== 2/5 Generating dataset from ARCOS =="
  [ -n "$RAW" ] || { echo "error: arcos_raw.gz not found in $GEN/data"; exit 1; }
  (cd "$GEN" && python3 main.py --data "$RAW" --max-lines 1000000 --sample-per-drug 10 \
    --balanced --max-units-per-lot 10 --max-mem-mb 8000 2>&1 | tail -3)
else
  echo; echo "== 2/5 Using existing dataset in $DATA (use 'make all' to regenerate) =="
fi

echo; echo "== 3/5 Building subsets =="
SUB="$OUT/data/d100_e1000"; PREV="$OUT/data/prevalence_1pct"
python3 "$AN/subset_dataset.py" "$DATA" "$SUB" 100 10
python3 "$AN/subset_prevalence.py" "$DATA" "$PREV" 0.01 42

echo; echo "== 4/5 Evaluating =="
export NODE_OPTIONS=--max-old-space-size=8192
cd "$CC"
node evaluate_rules.js "$DATA" --json "$OUT/full.json" > "$OUT/full.txt"
node evaluate_rules.js "$SUB" --json "$OUT/subset.json" > "$OUT/subset.txt"
node evaluate_rules.js "$PREV" --json "$OUT/prevalence.json" > "$OUT/prevalence.txt"
tail -3 "$OUT/full.txt"

echo; echo "== 5/5 Report =="
python3 - "$OUT/meta.json" "$ROOT" "$GEN" "$DATA" <<'PY'
import hashlib, json, platform, subprocess, sys
meta, root, gen, data = sys.argv[1:]
def sh(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
digest = hashlib.sha256()
with open(data + '/events.json', 'rb') as f:
    for block in iter(lambda: f.read(1 << 20), b''):
        digest.update(block)
json.dump({
    'date': sh('date', '+%Y-%m-%d %H:%M'),
    'core commit (chaincode + evaluator)': sh('git', '-C', root, 'rev-parse', '--short', 'HEAD'),
    'generator commit': sh('git', '-C', gen, 'rev-parse', '--short', 'HEAD'),
    'events.json sha256': digest.hexdigest(),
    'prevalence sampling seed': 42,
    'node': sh('node', '--version'),
    'python': platform.python_version(),
    'generator command': 'python3 main.py --max-lines 1000000 --sample-per-drug 10 --balanced --max-units-per-lot 10',
    'reproduce with': 'make all',
}, open(meta, 'w'), indent=2)
PY
python3 "$AN/generate_report.py" "$OUT/REPORT.md" "$OUT/meta.json" \
  "Full dataset=$OUT/full.json" "Subset of 100 drugs x 10=$OUT/subset.json" \
  "Anomaly prevalence ~1%=$OUT/prevalence.json"

if [ "$NETWORK" = 1 ]; then
  echo; echo "== Network: Caliper load test (100x10 subset) =="
  docker ps --format '{{.Names}}' | grep -q peer0.org1 || { echo "error: Fabric network is not up (peer0.org1)"; exit 1; }
  (cd "$CC/benchmark" && EPCIS_DATA_DIR="$SUB" ./run-benchmark.sh > "$OUT/caliper.log" 2>&1) || echo "Caliper failed, see caliper.log"
  grep -iE "Succ|Fail|Throughput|Avg Latency" "$OUT/caliper.log" | tail -12 | tee "$OUT/caliper_summary.txt"
fi

echo; echo "Done. Read: $OUT/REPORT.md"
