"""
direct_detection_accuracy.py
==============================
Recomputes the fraud-detection confusion matrix (TP/FP/TN/FN) at individual
event level, EXCLUDING the contribution of LotContaminationRule (which
propagates any single lot-level flag to all subsequent events of that lot,
per DSCSA 21 USC Sec.360eee-1(c) semantics).

WHY THIS EXISTS
---------------
The original detection_accuracy.py classified an event as "predicted positive"
if its aggregated riskScore was above a cutoff. Because LotContaminationRule
propagates ANY flag (even weak/noisy ones from LogisticsDiversionRule, which
fires 50-77% of the time even on legitimate baseline traffic) to every
subsequent event in the same lot, ~90-95% of ALL events end up flagged
regardless of true anomaly status -- making the aggregated score
non-discriminative (degenerate confusion matrix: TN=0, FN=0).

This script isolates "direct" rule violations (anything other than
LotContaminationRule) per event, giving a meaningful, non-degenerate
confusion matrix. See BUGS_FIXED_LOG.md entry
"2026-09-28: riskScore saturation / LotContaminationRule propagation".

METHODOLOGICAL NOTE FOR THESIS
-------------------------------
This is a post-hoc reanalysis of already-collected data (round_scores_raw
already recorded each event's full triggeredRules list, both direct and
inherited). No chaincode changes or benchmark re-run were required. The
*officially deployed* on-chain riskScore still includes LotContaminationRule's
propagation and remains non-discriminative as originally computed; only this
analysis-layer script produces the corrected metric.

Results obtained 2026-09-28 (see results/direct_detection_accuracy_results.md):
  scale            TP     FP    TN     FN   precision  recall    f1     accuracy
  d10_e100         1285   434   262   842      0.748    0.604   0.668    0.548
  d20_e100         1326   483   393   1098     0.733    0.547   0.627    0.521
  d50_e1000       14055  4485  2647  8781      0.758    0.615   0.679    0.557
  d100_e1000      17677  5969  2083  6985      0.748    0.717   0.732    0.604
  d1000_e1000     12589  4369  2207  6901      0.742    0.646   0.691    0.568
  d1000_e10000    53383 17375  3491 11770      0.754    0.819   0.786    0.661

Run on node003 from: ~/Workspace/blockchain-research/
"""
import json, glob, os, csv
from collections import defaultdict

BASE = os.path.expanduser("~/Workspace/blockchain-research/RUN_2026-09-27_multiscale")
SCALES = ["d10_e100", "d20_e100", "d50_e1000", "d100_e1000", "d1000_e1000", "d1000_e10000"]


def find_event_list(obj):
    if isinstance(obj, dict):
        if "eventList" in obj and isinstance(obj["eventList"], list):
            return obj["eventList"]
        for v in obj.values():
            r = find_event_list(v)
            if r is not None:
                return r
    return None


def main():
    results = []

    for scale in SCALES:
        scale_dir = os.path.join(BASE, scale)
        csv_path = os.path.join(scale_dir, "scenario_template.csv")
        events_path = os.path.join(scale_dir, "events.json")
        scores_glob = glob.glob(os.path.join(scale_dir, "round_scores_raw", "*.jsonl"))
        if not (os.path.exists(csv_path) and os.path.exists(events_path) and scores_glob):
            print(f"[{scale}] missing files, skipping")
            continue

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

        TP = FP = TN = FN = 0
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
                    if atype == "UNKNOWN":
                        continue
                    is_anomalous = (atype != "none")
                    triggered = rec.get("triggeredRules") or []
                    direct_rules = [
                        t.get("rule") for t in triggered
                        if isinstance(t, dict) and t.get("rule") != "LotContaminationRule"
                    ]
                    predicted_positive = len(direct_rules) > 0
                    if is_anomalous and predicted_positive:
                        TP += 1
                    elif is_anomalous and not predicted_positive:
                        FN += 1
                    elif not is_anomalous and predicted_positive:
                        FP += 1
                    else:
                        TN += 1

        total = TP + FP + TN + FN
        precision = TP / (TP + FP) if (TP + FP) else 0
        recall = TP / (TP + FN) if (TP + FN) else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0
        accuracy = (TP + TN) / total if total else 0
        results.append((scale, TP, FP, TN, FN, precision, recall, f1, accuracy))
        print(f"{scale}: TP={TP} FP={FP} TN={TN} FN={FN} | "
              f"precision={precision:.3f} recall={recall:.3f} f1={f1:.3f} accuracy={accuracy:.3f}")

    print()
    print("=== SUMMARY TABLE (direct-detection only, excludes LotContaminationRule propagation) ===")
    print(f"{'scale':<15}{'TP':>6}{'FP':>6}{'TN':>6}{'FN':>6}{'precision':>11}{'recall':>9}{'f1':>7}{'accuracy':>10}")
    for r in results:
        print(f"{r[0]:<15}{r[1]:>6}{r[2]:>6}{r[3]:>6}{r[4]:>6}{r[5]:>11.3f}{r[6]:>9.3f}{r[7]:>7.3f}{r[8]:>10.3f}")


if __name__ == "__main__":
    main()
