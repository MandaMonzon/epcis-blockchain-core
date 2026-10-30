#!/usr/bin/env bash
# One unattended run, in layer order: generator -> events -> contract -> network.
# Waits for --start-at, never touches the Fabric network while a Caliper/benchmark process is running,
# and writes everything under ~/overnight_<date>/ (read SUMMARY.md first).
#
# Usage (on node003):
#   nohup setsid scripts/overnight_node003.sh --start-at 10:00 > ~/overnight.out 2>&1 &
set -uo pipefail

START_AT="now"
NETWORK_DEADLINE_HOURS=6
while [ $# -gt 0 ]; do
  case "$1" in
    --start-at) START_AT="$2"; shift 2 ;;
    --network-deadline-hours) NETWORK_DEADLINE_HOURS="$2"; shift 2 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done

CORE="$(cd "$(dirname "$0")/.." && pwd)"
GEN="${GENERATOR_DIR:-$CORE/../epcis-arcos-etl-generator}"
RAW="${RAW:-$GEN/data/raw/arcos_raw.gz}"
FABRIC_NET="${FABRIC_NET:-$HOME/fabric-samples/test-network}"
SAMPLE_ROWS="${SAMPLE_ROWS:-300000}"
# Reading the full raw file in Python takes hours, so keep every THIN_EVERY-th line first (systematic sample,
# prime step so it does not align with periodic patterns). THIN_EVERY=0 disables it.
THIN_EVERY="${THIN_EVERY:-97}"
THIN_FILE="${THIN_FILE:-$HOME/arcos_thin${THIN_EVERY}.gz}"
RUN="$HOME/overnight_$(date +%Y%m%d)"
LOGS="$RUN/logs"
SUMMARY="$RUN/SUMMARY.tsv"
LOW="nice -n 19"
command -v ionice >/dev/null 2>&1 && LOW="nice -n 19 ionice -c3"
export OMP_NUM_THREADS=1
export VALIDATION_GENERATOR="$GEN"

mkdir -p "$LOGS"
: > "$SUMMARY"

if [ "$START_AT" != "now" ]; then
  target=$(date -d "$START_AT" +%s)
  [ "$target" -le "$(date +%s)" ] && target=$((target + 86400))
  echo "waiting until $(date -d "@$target") ..."
  while [ "$(date +%s)" -lt "$target" ]; do sleep 30; done
fi
echo "started $(date)" | tee "$RUN/started.txt"

n=0
step() {
  local name="$1"; shift
  n=$((n + 1))
  local log; log=$(printf "%s/%02d_%s.log" "$LOGS" "$n" "$name")
  local t0=$SECONDS
  echo "[$(date +%H:%M:%S)] $name"
  "$@" > "$log" 2>&1
  local code=$?
  printf "%02d\t%s\t%s\t%ss\t%s\n" "$n" "$name" "$([ $code -eq 0 ] && echo PASS || echo "FAIL($code)")" "$((SECONDS - t0))" "$log" >> "$SUMMARY"
  return $code
}

skip() {
  n=$((n + 1))
  printf "%02d\t%s\tSKIPPED\t0s\t%s\n" "$n" "$1" "$2" >> "$SUMMARY"
  echo "skipped $1: $2"
}

network_busy() { pgrep -f -i "caliper|run-benchmark" > /dev/null 2>&1; }

wait_for_idle_network() {
  local deadline=$(( $(date +%s) + NETWORK_DEADLINE_HOURS * 3600 )) quiet=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if network_busy; then quiet=0; else quiet=$((quiet + 1)); fi
    [ "$quiet" -ge 3 ] && return 0
    sleep 600
  done
  return 1
}

# Layer 1 - ETL generator
step pull_core        git -C "$CORE" pull --ff-only
step pull_generator   git -C "$GEN" pull --ff-only
step install_jsonschema python3 -m pip install --user -q jsonschema
step generator_tests  bash -c "cd '$GEN' && python3 -m unittest discover -s tests -t ."
if [ "$THIN_EVERY" -gt 0 ] && [ "$RAW" != "$THIN_FILE" ]; then
  if [ -s "$THIN_FILE" ]; then
    skip thin_raw "reusing $THIN_FILE"
  else
    step thin_raw bash -c "nice -n 10 gzip -dc < '$RAW' | nice -n 10 awk 'NR==1||NR%$THIN_EVERY==0' | nice -n 10 gzip -1 > '$THIN_FILE.tmp' && mv '$THIN_FILE.tmp' '$THIN_FILE'"
  fi
  [ -s "$THIN_FILE" ] && RAW="$THIN_FILE"
fi
step real_sample      bash -c "cd '$GEN' && $LOW python3 main.py --data '$RAW' --sample-rows $SAMPLE_ROWS --seed 1 --sample-per-drug 10 --balanced --max-units-per-lot 10 --max-mem-mb 6000 --output-dir '$RUN/real_generated'"

# Layer 2 - EPCIS events
step epcis_schema     bash -c "cd '$CORE' && python3 -m validation.checks_schema '$RUN/real_generated/events.json' --work '$RUN'"

# Layer 3 - smart contract
step contract_tests   bash -c "cd '$CORE' && make test"
step validate_real    bash -c "cd '$CORE' && $LOW make validate VALIDATE_ARGS=\"--seeds ${SEEDS:-30} --raw '$RAW' --sample-rows $SAMPLE_ROWS --sample-seed 1 --work '$RUN/validate_work' --report '$RUN/REPORT_real.md'\""
step shared_ledger_time bash -c "cd '$CORE' && NODE_OPTIONS=--max-old-space-size=8192 $LOW node validation/shared_ledger_scores.js '$RUN/validate_work/seed_1' --order time"
step shared_ledger_file bash -c "cd '$CORE' && NODE_OPTIONS=--max-old-space-size=8192 $LOW node validation/shared_ledger_scores.js '$RUN/validate_work/seed_1' --order file"

# Layer 4 - Fabric network (wipes the test-network ledger; only when nobody is using it)
if grep -q "contract_tests.*FAIL" "$SUMMARY"; then
  skip fabric_network "contract tests failed; the network was not touched"
elif [ ! -d "$FABRIC_NET" ]; then
  skip fabric_network "$FABRIC_NET not found"
elif ! wait_for_idle_network; then
  skip fabric_network "a Caliper/benchmark process was still running after ${NETWORK_DEADLINE_HOURS}h; the network was not touched"
else
  step fabric_network bash -c "cd '$CORE' && RUN_CALIPER_SMOKE=yes CONFIRM_WIPE=yes WORK='$RUN/network' FABRIC_NET='$FABRIC_NET' scripts/network_equivalence.sh '$RUN/validate_work/seed_1'"
fi

{
  echo "# Overnight run $(date +%F)"
  echo
  echo "Started: $(cat "$RUN/started.txt")  Finished: $(date)"
  echo
  echo "| # | Step | Result | Time | Log |"
  echo "|---|------|--------|------|-----|"
  awk -F'\t' '{printf "| %s | %s | %s | %s | %s |\n", $1, $2, $3, $4, $5}' "$SUMMARY"
  echo
  echo "## Key results"
  echo
  echo '```'
  tail -n 6 "$LOGS"/*_epcis_schema.log 2>/dev/null
  grep -h -E "Summary|FAIL|NOT RUN" "$RUN/REPORT_real.md" 2>/dev/null | cut -c1-240
  cat "$LOGS"/*_shared_ledger_*.log 2>/dev/null
  tail -n 8 "$LOGS"/*_fabric_network.log 2>/dev/null
  echo '```'
} > "$RUN/SUMMARY.md"
echo "done: $RUN/SUMMARY.md"
