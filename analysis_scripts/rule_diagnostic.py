"""
rule_diagnostic.py
===================
Diagnostic script: crosstab of which chaincode rule fires for each anomaly_type,
at individual event level, across benchmark scales.

Developed 2026-09-28 during multi-scale benchmark analysis. This script confirmed
that LotContaminationRule fires on ~90-95% of ALL events (including baseline
'none' transactions) and LogisticsDiversionRule fires on 50-77% of ALL events
regardless of injected anomaly type -- revealing that the aggregated/official
riskScore does not meaningfully discriminate baseline from anomalous traffic.

Run on node003 from: ~/Workspace/blockchain-research/
"""
import json, glob, os, sys
from collections import defaultdict, Counter

BASE = os.path.expanduser("~/Workspace/blockchain-research/RUN_2026-09-27_multiscale")
SCALES = ["d10_e100", "d20_e100", "d50_e1000", "d100_e1000", "d1000_e1000", "d1000_e10000"]


def find_event_list(obj):
    """EPCIS 2.0 documents nest eventList under epcisBody; search recursively."""
    if isinstance(obj, dict):
        if "eventList" in obj and isinstance(obj["eventList"], list):
            return obj["eventList"]
        for v in obj.values():
            r = find_event_list(v)
            if r is not None:
                return r
    return None


def rule_key(entry):
    """triggeredRules entries are dicts like {"rule": "...", "code": "...", "score": N}."""
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        for k in ("ruleName", "rule", "name", "type", "code", "id"):
            if k in entry:
                return f"{k}={entry[k]}"
        return json.dumps(entry, sort_keys=True)
    return str(entry)


def main():
    sample_shown = False
    overall = defaultdict(lambda: defaultdict(Counter))
    event_counts = defaultdict(lambda: defaultdict(int))

    for scale in SCALES:
        scale_dir = os.path.join(BASE, scale)
        if not os.path.isdir(scale_dir):
            continue
        csv_path = os.path.join(scale_dir, "scenario_template.csv")
        events_path = os.path.join(scale_dir, "events.json")
        scores_glob = glob.glob(os.path.join(scale_dir, "round_scores_raw", "*.jsonl"))
        if not (os.path.exists(csv_path) and os.path.exists(events_path) and scores_glob):
            print(f"[{scale}] missing files, skipping")
            continue

        import csv
        tx_anomaly = {}
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                tid = row.get("transaction_id") or row.get("transactionId")
                atype = row.get("anomaly_type") or row.get("anomalyType") or "none"
                if tid:
                    tx_anomaly[tid] = atype

        with open(events_path) as f:
            events_data = json.load(f)
        event_list = find_event_list(events_data) or []

        valid_tids = set(tx_anomaly.keys())
        eventid_to_tid = {}

        def scan(obj, found):
            if found[0]:
                return
            if isinstance(obj, str):
                if obj in valid_tids:
                    found[0] = obj
            elif isinstance(obj, dict):
                for v in obj.values():
                    scan(v, found)
                    if found[0]:
                        return
            elif isinstance(obj, list):
                for v in obj:
                    scan(v, found)
                    if found[0]:
                        return

        for ev in event_list:
            eid = ev.get("eventID") or ev.get("eventId")
            if not eid:
                continue
            found = [None]
            scan(ev, found)
            if found[0]:
                eventid_to_tid[eid] = found[0]

        for jf in scores_glob:
            with open(jf) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    eid = rec.get("eventID") or rec.get("eventId")
                    tid = eventid_to_tid.get(eid)
                    atype = tx_anomaly.get(tid, "UNKNOWN") if tid else "UNKNOWN"
                    event_counts[scale][atype] += 1
                    triggered = rec.get("triggeredRules") or []
                    if not sample_shown and triggered:
                        print(f"scale={scale} raw triggeredRules[0]:", json.dumps(triggered[0], indent=2)[:500])
                        sample_shown = True
                    for entry in triggered:
                        overall[scale][atype][rule_key(entry)] += 1

    print()
    print("=== RULE FIRE RATE BY anomaly_type (top 8 rules per scale) ===")
    for scale in SCALES:
        if scale not in overall:
            continue
        print(f"\n--- {scale} ---")
        for atype in sorted(overall[scale].keys()):
            n = event_counts[scale][atype]
            counter = overall[scale][atype]
            top = counter.most_common(8)
            print(f"  anomaly_type={atype} (n_events={n})")
            for rule, cnt in top:
                pct = 100.0 * cnt / n if n else 0
                print(f"    {rule}: {cnt} ({pct:.1f}%)")


if __name__ == "__main__":
    main()
